'use strict';
/**
 * runtime-monitor.js — Node.js --require preload (CJS) that runs INSIDE the container.
 * Monkey-patches fs, net, http, https, and child_process to capture runtime behavior.
 * This is the fallback (and complementary) approach to strace.
 */

const fs   = require('fs');
const net  = require('net');
const http = require('http');
const https = require('https');
const cp   = require('child_process');
const path = require('path');

const LOG_FILE    = '/sandbox/logs/runtime.json';
const INSTALL_DIR = '/sandbox/node_modules';

const findings = {
  networkCalls:     [],
  fileWrites:       [],
  spawnedProcesses: [],
};

// ── SENSITIVE PATH DETECTION ─────────────────────────────────────────────────

const SENSITIVE_PATH_PREFIXES = [
  '/etc/passwd', '/etc/shadow', '/etc/hosts', '/etc/sudoers',
  '/root/.ssh', '/home/', '/.aws', '/.ssh', '/.npmrc', '/.netrc',
];

function isOutsideInstallDir(filepath) {
  if (!filepath || typeof filepath !== 'string') return false;
  try {
    const abs = path.resolve(String(filepath));
    const inInstall = abs.startsWith(INSTALL_DIR) || abs.startsWith('/tmp') || abs.startsWith('/sandbox/logs');
    if (inInstall) return false;
    return SENSITIVE_PATH_PREFIXES.some(p => abs.startsWith(p)) || !abs.startsWith('/sandbox');
  } catch (_) { return false; }
}

// ── NET: Patch socket connect ────────────────────────────────────────────────

const _netConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function(options, ...args) {
  const host = (typeof options === 'object' ? (options.host || options.hostname) : String(options)) || 'unknown';
  const port = (typeof options === 'object' ? options.port : args[0]) || 0;
  findings.networkCalls.push({
    host: String(host),
    port: Number(port),
    timestamp: new Date().toISOString(),
    blocked: true,
  });
  return _netConnect.apply(this, [options, ...args]);
};

// ── HTTP / HTTPS: Patch request ──────────────────────────────────────────────

function patchHttpRequest(mod, proto) {
  const _orig = mod.request.bind(mod);
  mod.request = function(urlOrOpts, ...rest) {
    let url;
    if (typeof urlOrOpts === 'string') {
      url = urlOrOpts;
    } else if (urlOrOpts && urlOrOpts.href) {
      url = urlOrOpts.href;
    } else if (urlOrOpts) {
      url = `${proto}://${urlOrOpts.hostname || urlOrOpts.host || 'unknown'}${urlOrOpts.path || ''}`;
    }
    findings.networkCalls.push({ url, protocol: proto, timestamp: new Date().toISOString(), blocked: true });
    return _orig(urlOrOpts, ...rest);
  };
}

patchHttpRequest(http, 'http');
patchHttpRequest(https, 'https');

// ── FS: Patch write operations ───────────────────────────────────────────────

function patchWrite(fn, name) {
  return function(filepath, ...rest) {
    if (isOutsideInstallDir(filepath)) {
      findings.fileWrites.push({ path: String(filepath), operation: name, timestamp: new Date().toISOString() });
    }
    return fn.apply(this, [filepath, ...rest]);
  };
}

fs.writeFile     = patchWrite(fs.writeFile,     'writeFile');
fs.writeFileSync = patchWrite(fs.writeFileSync, 'writeFileSync');
fs.appendFile    = patchWrite(fs.appendFile,    'appendFile');
fs.appendFileSync = patchWrite(fs.appendFileSync, 'appendFileSync');

// ── CHILD_PROCESS: Patch spawn, exec, execFile, fork ────────────────────────

function recordProcess(command, args, method) {
  findings.spawnedProcesses.push({
    command: String(command),
    args: Array.isArray(args) ? args.map(String) : [],
    method,
    timestamp: new Date().toISOString(),
  });
}

const _spawn = cp.spawn;
cp.spawn = function(cmd, args, ...rest) {
  recordProcess(cmd, args, 'spawn');
  return _spawn.apply(this, [cmd, args, ...rest]);
};

const _exec = cp.exec;
cp.exec = function(cmd, ...rest) {
  recordProcess(cmd, [], 'exec');
  return _exec.apply(this, [cmd, ...rest]);
};

const _execFile = cp.execFile;
cp.execFile = function(cmd, args, ...rest) {
  recordProcess(cmd, args, 'execFile');
  return _execFile.apply(this, [cmd, args, ...rest]);
};

const _execSync = cp.execSync;
cp.execSync = function(cmd, ...rest) {
  recordProcess(cmd, [], 'execSync');
  return _execSync.apply(this, [cmd, ...rest]);
};

// ── FLUSH LOG ON EXIT ─────────────────────────────────────────────────────────

function writeLog() {
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Use the original un-patched writeFileSync to avoid infinite recursion
    require('fs').writeFileSync(LOG_FILE, JSON.stringify(findings, null, 2));
  } catch (_) { /* best-effort */ }
}

process.on('exit', writeLog);
process.on('uncaughtException', () => writeLog());
