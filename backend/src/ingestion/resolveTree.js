import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fetchLatestVersion } from './npmRegistry.js';

/**
 * Resolve the full transitive dependency tree.
 * Accepts either a packageJson object or a single packageName string.
 * Returns: { tree: [{name, version, depth, parent}], uniquePackages: [{name, version}] }
 */
export async function resolveTree(packageJsonObj, packageName) {
  let pkgJson = packageJsonObj;

  // Single package mode — build a minimal wrapper package.json
  if (packageName && !pkgJson) {
    const version = await fetchLatestVersion(packageName);
    pkgJson = {
      name: 'sentinel-resolve-tmp',
      version: '1.0.0',
      dependencies: { [packageName]: `^${version}` },
    };
  }

  if (!pkgJson) throw new Error('resolveTree: no input provided');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sentinel-resolve-'));

  try {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify(pkgJson));

    // Generate lockfile without downloading packages
    execSync(
      'npm install --package-lock-only --ignore-scripts --no-audit --loglevel=error',
      { cwd: tmpDir, stdio: 'pipe', timeout: 90_000 }
    );

    const lockRaw = await fs.readFile(path.join(tmpDir, 'package-lock.json'), 'utf-8');
    const lockfile = JSON.parse(lockRaw);
    return parseLockfile(lockfile);

  } catch (err) {
    // Fallback: just return direct deps from package.json without transitive resolution
    console.warn('[resolveTree] Lockfile generation failed, using direct deps only:', err.message);
    return fallbackParse(pkgJson, packageName);

  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Lockfile v2/v3 parser ──────────────────────────────────────────────────────
// packages field: { "node_modules/express": { version, ... }, "node_modules/a/node_modules/b": ... }

function parseLockfile(lockfile) {
  const packages = lockfile.packages || {};
  const tree = [];
  const seen = new Map();

  for (const [pkgPath, pkgData] of Object.entries(packages)) {
    if (pkgPath === '') continue; // root package

    // Split path on "node_modules/" — gives us the nesting depth
    const segments = pkgPath.split('node_modules/').filter(Boolean);
    const name    = segments[segments.length - 1];
    const depth   = segments.length - 1;
    const parent  = segments.length > 1 ? segments[segments.length - 2].replace(/\/$/, '') : null;
    const version = pkgData.version || 'unknown';

    tree.push({ name, version, depth, parent });

    const key = `${name}@${version}`;
    if (!seen.has(key)) seen.set(key, { name, version, depth });
  }

  return { tree, uniquePackages: Array.from(seen.values()) };
}

// ── Fallback: parse direct dependencies only ──────────────────────────────────

function fallbackParse(pkgJson, singlePackageName) {
  if (singlePackageName) {
    const entry = { name: singlePackageName, version: 'latest', depth: 0, parent: null };
    return { tree: [entry], uniquePackages: [{ name: singlePackageName, version: 'latest' }] };
  }

  const deps = {
    ...(pkgJson.dependencies || {}),
    ...(pkgJson.devDependencies || {}),
  };

  const tree = Object.entries(deps).map(([name, rawVersion]) => ({
    name,
    version: rawVersion.replace(/^[\^~>=<]/, ''),
    depth: 0,
    parent: null,
  }));

  const uniquePackages = tree.map(({ name, version }) => ({ name, version }));
  return { tree, uniquePackages };
}
