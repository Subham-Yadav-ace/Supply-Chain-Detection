import fs from 'fs/promises';
import path from 'path';

// ── Strace output patterns ────────────────────────────────────────────────────

// Benign hostnames/IPs — npm registry, DNS, localhost connections during install
const BENIGN_HOSTS = [
  'registry.npmjs.org', 'registry-1.docker.io', '8.8.8.8', '1.1.1.1',
  '127.0.0.1', '::1', '0.0.0.0', 'localhost',
];
const BENIGN_PORT_RANGES = [[53, 53]]; // DNS

function isBenignConnection(host, port) {
  if (BENIGN_HOSTS.some(h => String(host).includes(h))) return true;
  return BENIGN_PORT_RANGES.some(([lo, hi]) => port >= lo && port <= hi);
}

// connect(fd, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("1.2.3.4")}, 16) = ...
const RE_CONNECT_INET = /connect\(\d+,\s*\{sa_family=AF_INET6?,\s*sin6?_port=htons\((\d+)\),\s*sin6?_addr(?:=inet_addr)?\("([^"]+)"\)/;

// openat(AT_FDCWD, "/etc/passwd", O_WRONLY|...) = fd
const RE_OPENAT_WRITE = /openat\([^,]+,\s*"([^"]+)",\s*([^)]*O_WRONLY[^)]*|[^)]*O_RDWR[^)]*)\)/;

// execve("/usr/bin/curl", ["curl", ...], ...) = 0
const RE_EXECVE = /execve\("([^"]+)",\s*\[([^\]]*)\]/;

// Paths that are suspicious to write to
const SENSITIVE_WRITE_PATHS = [
  '/etc/', '/root/', '/home/', '/.ssh', '/.aws',
  '/.npmrc', '/.netrc', '/proc/', '/sys/',
];

// Paths that are fine to write (install artifacts)
const BENIGN_WRITE_PREFIXES = [
  '/sandbox/', '/tmp/', '/proc/self/', '/dev/',
];

function isSensitivePath(filepath) {
  if (!filepath) return false;
  const benign = BENIGN_WRITE_PREFIXES.some(p => filepath.startsWith(p));
  if (benign) return false;
  return SENSITIVE_WRITE_PATHS.some(p => filepath.startsWith(p));
}

// ── Strace log parser ─────────────────────────────────────────────────────────

function parseStrace(content) {
  const networkCalls    = [];
  const fileWrites      = [];
  const spawnedProcesses = [];
  const seenConnects    = new Set();
  const seenExecves     = new Set();

  for (const line of content.split('\n')) {
    // Network connections
    const netMatch = line.match(RE_CONNECT_INET);
    if (netMatch) {
      const port = parseInt(netMatch[1]);
      const host = netMatch[2];
      const key  = `${host}:${port}`;
      if (!seenConnects.has(key) && !isBenignConnection(host, port)) {
        seenConnects.add(key);
        networkCalls.push({ host, port, blocked: false, source: 'strace' });
      }
    }

    // Suspicious file writes
    const writeMatch = line.match(RE_OPENAT_WRITE);
    if (writeMatch) {
      const filepath = writeMatch[1];
      if (isSensitivePath(filepath)) {
        fileWrites.push({ path: filepath, operation: 'openat(write)', source: 'strace' });
      }
    }

    // Spawned processes
    const execMatch = line.match(RE_EXECVE);
    if (execMatch) {
      const cmd  = execMatch[1];
      const key  = cmd;
      // Skip internal node/npm spawns
      if (!seenExecves.has(key) && !cmd.includes('/node') && !cmd.includes('/npm') && !cmd.includes('/sh')) {
        seenExecves.add(key);
        // Parse args: ["arg1", "arg2", ...]
        const rawArgs = execMatch[2];
        const args = rawArgs.match(/"([^"]*)"/g)?.map(a => a.slice(1, -1)) || [];
        spawnedProcesses.push({ command: cmd, args: args.slice(1), source: 'strace' });
      }
    }
  }

  return { networkCalls, fileWrites, spawnedProcesses };
}

// ── Merge strace + runtime-monitor findings (deduplicate) ────────────────────

function mergefindings(strace, runtime) {
  const merged = {
    networkCalls: [...strace.networkCalls],
    fileWrites:   [...strace.fileWrites],
    spawnedProcesses: [...strace.spawnedProcesses],
  };

  // Add runtime findings not already captured by strace
  for (const call of (runtime.networkCalls || [])) {
    const key = call.url || `${call.host}:${call.port}`;
    const alreadySeen = merged.networkCalls.some(c => (c.url || `${c.host}:${c.port}`) === key);
    if (!alreadySeen) merged.networkCalls.push({ ...call, source: 'runtime-monitor' });
  }

  for (const write of (runtime.fileWrites || [])) {
    const alreadySeen = merged.fileWrites.some(w => w.path === write.path);
    if (!alreadySeen) merged.fileWrites.push({ ...write, source: 'runtime-monitor' });
  }

  for (const proc of (runtime.spawnedProcesses || [])) {
    const alreadySeen = merged.spawnedProcesses.some(p => p.command === proc.command);
    if (!alreadySeen) merged.spawnedProcesses.push({ ...proc, source: 'runtime-monitor' });
  }

  return merged;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Parse all log files written by the sandbox container and return structured findings.
 * @param {string} logsDir  - Host path to the mounted logs directory
 * @param {boolean} timedOut
 * @returns {Promise<SandboxFindings>}
 */
export async function parseFindings(logsDir, timedOut = false) {
  const read = async (filename) => {
    try {
      return await fs.readFile(path.join(logsDir, filename), 'utf-8');
    } catch (_) {
      return null;
    }
  };

  // ── Determine which monitoring method was used ───────────────────────────
  const method     = (await read('method.txt'))?.trim() || 'unknown';
  const exitCode   = parseInt((await read('exit-code.txt'))?.trim()) || null;

  // ── Parse strace log (if available) ─────────────────────────────────────
  const straceContent = await read('strace.log');
  const straceFindings = straceContent
    ? parseStrace(straceContent)
    : { networkCalls: [], fileWrites: [], spawnedProcesses: [] };

  // ── Parse runtime-monitor JSON log ───────────────────────────────────────
  let runtimeFindings = { networkCalls: [], fileWrites: [], spawnedProcesses: [] };
  const runtimeContent = await read('runtime.json');
  if (runtimeContent) {
    try { runtimeFindings = JSON.parse(runtimeContent); } catch (_) {}
  }

  // ── Parse env-monitor JSON log ───────────────────────────────────────────
  let envAccess = [];
  const envContent = await read('env-access.json');
  if (envContent) {
    try { envAccess = JSON.parse(envContent); } catch (_) {}
  }

  // ── Merge everything ──────────────────────────────────────────────────────
  const merged = mergefindings(straceFindings, runtimeFindings);

  const findings = {
    networkCalls:     merged.networkCalls,
    fileWrites:       merged.fileWrites,
    envAccess:        envAccess.filter(e => e.sensitive),   // only report sensitive reads
    spawnedProcesses: merged.spawnedProcesses,
    timedOut,
    exitCode,
    monitoringMethod: method,
  };

  // ── Summarise for logging ─────────────────────────────────────────────────
  console.log(
    `[Monitor] Findings — network:${findings.networkCalls.length}` +
    ` fileWrites:${findings.fileWrites.length}` +
    ` envAccess:${findings.envAccess.length}` +
    ` processes:${findings.spawnedProcesses.length}` +
    ` method:${method}`
  );

  return findings;
}
