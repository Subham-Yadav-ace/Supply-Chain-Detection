'use strict';
/**
 * env-monitor.js — Node.js --require preload (CJS) that runs INSIDE the container.
 * Wraps process.env with a Proxy to log every environment variable access.
 * Written CJS because --require only works with CommonJS modules.
 */

const fs = require('fs');
const path = require('path');

const LOG_FILE = '/sandbox/logs/env-access.json';

const SENSITIVE_PATTERNS = [
  /AWS_/i, /SECRET/i, /TOKEN/i, /API_KEY/i, /PASSWORD/i,
  /PASS$/i, /AUTH/i, /SSH/i, /PRIVATE/i, /CREDENTIAL/i,
  /NPM_TOKEN/i, /GITHUB_TOKEN/i, /GITLAB_TOKEN/i, /DATABASE_URL/i,
];

const accessLog = [];

function isSensitive(key) {
  return SENSITIVE_PATTERNS.some(p => p.test(String(key)));
}

// Wrap process.env with a Proxy to intercept all reads
const originalEnv = process.env;
process.env = new Proxy(originalEnv, {
  get(target, prop) {
    if (typeof prop === 'string' && prop !== 'toJSON' && prop !== 'length') {
      accessLog.push({
        key: prop,
        timestamp: new Date().toISOString(),
        sensitive: isSensitive(prop),
      });
    }
    return Reflect.get(target, prop);
  },
  set(target, prop, value) {
    return Reflect.set(target, prop, value);
  },
});

// Flush log to disk on any exit
function writeLog() {
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LOG_FILE, JSON.stringify(accessLog, null, 2));
  } catch (_) { /* best-effort */ }
}

process.on('exit', writeLog);
process.on('uncaughtException', (err) => { writeLog(); });
