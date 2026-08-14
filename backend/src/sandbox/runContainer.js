import Docker from 'dockerode';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';
import { parseFindings } from './monitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const docker = new Docker(); // connects to /var/run/docker.sock by default
const SANDBOX_IMAGE   = 'sentinelchain-sandbox:latest';
const TIMEOUT_MS      = parseInt(process.env.SANDBOX_TIMEOUT_MS) || 90000;
const MEMORY_MB       = parseInt(process.env.SANDBOX_MEMORY_MB)  || 256;

// Known safe npm registry IPs / domains — used by monitor to filter benign connections
export const NPM_REGISTRY_HOSTS = ['registry.npmjs.org', 'npm.pkg.github.com'];

// ── Image helpers ─────────────────────────────────────────────────────────────

async function imageExists() {
  try { await docker.getImage(SANDBOX_IMAGE).inspect(); return true; }
  catch (_) { return false; }
}

async function buildImage() {
  console.log('[Sandbox] Building sandbox image (first run only)…');
  const buildContext = __dirname;
  const files = ['Dockerfile.sandbox', 'env-monitor.js', 'runtime-monitor.js'];

  await new Promise((resolve, reject) => {
    docker.buildImage(
      { context: buildContext, src: files },
      { t: SANDBOX_IMAGE, dockerfile: 'Dockerfile.sandbox' },
      (err, stream) => {
        if (err) return reject(new Error(`Docker build failed: ${err.message}`));
        docker.modem.followProgress(stream, (err, output) => {
          if (err) return reject(new Error(`Docker build stream error: ${err.message}`));
          console.log('[Sandbox] Image ready.');
          resolve(output);
        });
      }
    );
  });
}

export async function ensureSandboxImage() {
  if (!(await imageExists())) await buildImage();
}

// ── Build the in-container shell command ──────────────────────────────────────
// Tries strace first; falls back to plain preload-only if strace unavailable.

function buildInstallCmd(pkgSpec) {
  // Escape single quotes in package name
  const safe = pkgSpec.replace(/'/g, "\\'");

  return `
    set -e
    mkdir -p /sandbox/logs
    NPM_OPTS="--no-save --prefer-offline --ignore-scripts=false --loglevel=warn"

    if command -v strace > /dev/null 2>&1; then
      strace -f \\
        -e trace=network,write,execve,openat \\
        -o /sandbox/logs/strace.log \\
        node --require /sandbox/env-monitor.js \\
             --require /sandbox/runtime-monitor.js \\
             /usr/local/bin/npm install '${safe}' $NPM_OPTS \\
             2>/sandbox/logs/npm.log
      echo "strace" > /sandbox/logs/method.txt
    else
      node --require /sandbox/env-monitor.js \\
           --require /sandbox/runtime-monitor.js \\
           /usr/local/bin/npm install '${safe}' $NPM_OPTS \\
           2>/sandbox/logs/npm.log
      echo "preload" > /sandbox/logs/method.txt
    fi
    echo $? > /sandbox/logs/exit-code.txt
  `;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run a single npm package inside an isolated Docker sandbox.
 * @param {string} packageName
 * @param {string} version
 * @returns {Promise<SandboxFindings>}
 */
export async function runSandbox(packageName, version) {
  let pkgSpec = version && !packageName.endsWith('.tgz') ? `${packageName}@${version}` : packageName;
  const safeTag = packageName.replace(/[^a-z0-9_-]/gi, '_');
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `sentinel-${safeTag}-`));
  const logsDir = path.join(tmpDir, 'logs');
  const bindMounts = [`${logsDir}:/sandbox/logs:rw`];

  if (packageName.startsWith('/') && packageName.endsWith('.tgz')) {
    pkgSpec = '/sandbox/local-package.tgz';
    bindMounts.push(`${packageName}:/sandbox/local-package.tgz:ro`);
  }

  await fs.mkdir(logsDir, { recursive: true });
  await fs.chmod(logsDir, 0o777); // non-root container user must write here

  let container  = null;
  let timedOut   = false;

  try {
    await ensureSandboxImage();

    // ── Create container ────────────────────────────────────────────────────
    container = await docker.createContainer({
      Image: SANDBOX_IMAGE,
      Cmd: ['sh', '-c', buildInstallCmd(pkgSpec)],
      Env: [
        `SENTINEL_PACKAGE=${pkgSpec}`,
        'HOME=/tmp',
        'NPM_CONFIG_CACHE=/tmp/.npm',
        'NPM_CONFIG_PREFIX=/sandbox/npm-global',
      ],
      WorkingDir: '/sandbox',
      HostConfig: {
        // Use bridge so npm can download packages; strace captures what postinstall scripts attempt
        // After install completes, monitor flags non-registry connections
        NetworkMode: 'bridge',
        Memory:      MEMORY_MB * 1024 * 1024,
        MemorySwap:  MEMORY_MB * 1024 * 1024,            // disable swap
        CpuShares:   512,
        PidsLimit:   128,                                 // prevent fork bombs
        AutoRemove:  false,
        Binds:       [`${logsDir}:/sandbox/logs:rw`],
        CapAdd:      ['SYS_PTRACE'],                      // enables strace inside container
        SecurityOpt: ['seccomp=unconfined'],              // required for strace syscall filters
        ReadonlyRootfs: false,
      },
    });

    // ── Start + apply hard timeout ──────────────────────────────────────────
    await container.start();
    console.log(`[Sandbox] Container started for ${pkgSpec}`);

    const timeoutHandle = setTimeout(async () => {
      timedOut = true;
      console.warn(`[Sandbox] Timeout! Killing container for ${pkgSpec}`);
      try { await container.kill({ signal: 'SIGKILL' }); } catch (_) {}
    }, TIMEOUT_MS);

    await container.wait();
    clearTimeout(timeoutHandle);

    console.log(`[Sandbox] Container finished for ${pkgSpec} (timedOut=${timedOut})`);

    // ── Collect + parse logs ────────────────────────────────────────────────
    const findings = await parseFindings(logsDir, timedOut);
    return findings;

  } catch (err) {
    console.error(`[Sandbox] Error for ${pkgSpec}:`, err.message);
    // Return minimal findings on error rather than throwing — scan continues
    return {
      networkCalls: [], fileWrites: [], envAccess: [],
      spawnedProcesses: [], timedOut, error: err.message,
    };
  } finally {
    // ── Always clean up ─────────────────────────────────────────────────────
    if (container) {
      try { await container.remove({ force: true }); } catch (_) {}
    }
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}
