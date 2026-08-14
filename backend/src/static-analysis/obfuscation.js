import axios from 'axios';
import * as tar from 'tar';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import os from 'os';
import { parse as acornParse } from 'acorn';
import { simple as acornWalk } from 'acorn-walk';

// ── Regex patterns to flag ────────────────────────────────────────────────────

const PATTERNS = [
  { name: 'eval',              re: /\beval\s*\(/,                              severity: 'high'     },
  { name: 'Function-ctor',     re: /\bnew\s+Function\s*\(/,                    severity: 'high'     },
  { name: 'atob',              re: /\batob\s*\(/,                              severity: 'medium'   },
  { name: 'base64-buffer',     re: /Buffer\.from\s*\([^,)]+,\s*['"]base64['"]/, severity: 'high'  },
  { name: 'hex-escape',        re: /\\x[0-9a-fA-F]{2}/,                        severity: 'medium'  },
  { name: 'fromCharCode',      re: /String\.fromCharCode\s*\(/,                severity: 'medium'  },
  { name: 'charcode-array',    re: /\[\s*\d+\s*,\s*\d+\s*,\s*\d+.*\]\.map.*fromCharCode/, severity: 'high' },
];

const LONG_LINE_CHARS   = 10_000;  // single line longer than this is suspicious
const HIGH_ENTROPY      = 4.5;     // Shannon entropy threshold

// ── Entropy helper ────────────────────────────────────────────────────────────

function shannonEntropy(str) {
  const freq = {};
  for (const ch of str) freq[ch] = (freq[ch] || 0) + 1;
  const n = str.length;
  return -Object.values(freq).reduce((acc, c) => acc + (c / n) * Math.log2(c / n), 0);
}

// ── Obfuscation score ─────────────────────────────────────────────────────────

const SEVERITY_WEIGHT = { critical: 1.0, high: 0.7, medium: 0.4, low: 0.1 };

function calcScore(hits) {
  if (!hits.length) return 0;
  const total = hits.reduce((acc, h) => acc + (SEVERITY_WEIGHT[h.severity] || 0.1), 0);
  return parseFloat(Math.min(total / 5, 1.0).toFixed(2));
}

// ── File scanner ──────────────────────────────────────────────────────────────

async function scanFile(filePath, relBase, hits) {
  let content;
  try { content = await fs.readFile(filePath, 'utf-8'); }
  catch (_) { return; }

  const relPath = filePath.replace(relBase, '').replace(/^\//, '');
  const lines = content.split('\n');

  // Long high-entropy line heuristic
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > LONG_LINE_CHARS && shannonEntropy(line.slice(0, 500)) > HIGH_ENTROPY) {
      hits.push({ file: relPath, line: i + 1, pattern: 'high-entropy-minified', severity: 'medium',
        snippet: line.slice(0, 120) + '…' });
    }
  }

  // Regex pattern scan
  for (const { name, re, severity } of PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        hits.push({ file: relPath, line: i + 1, pattern: name, severity,
          snippet: lines[i].trim().slice(0, 120) });
      }
    }
  }

  // AST walk: detect eval(<dynamic>)
  try {
    const ast = acornParse(content, {
      ecmaVersion: 'latest', sourceType: 'script',
      allowHashBang: true, locations: true,
    });
    acornWalk(ast, {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === 'Identifier' && callee.name === 'eval' && node.arguments.length) {
          const arg = node.arguments[0];
          // eval of a non-literal is always suspicious
          if (arg.type !== 'Literal') {
            hits.push({ file: relPath, line: node.loc?.start.line || 0,
              pattern: 'eval-of-dynamic-expr', severity: 'critical',
              snippet: `eval(<${arg.type}>)` });
          }
        }
      },
    });
  } catch (_) { /* skip AST for JSX/TS files that acorn can't parse */ }
}

async function scanDir(dir, relBase, hits) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch (_) { return; }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      await scanDir(full, relBase, hits);
    } else if (entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name)) {
      await scanFile(full, relBase, hits);
    }
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Download and statically analyze a package tarball for obfuscation signals.
 * @returns {{ obfuscationHits, obfuscationScore, error? }}
 */
export async function analyzeObfuscation(packageName, version, tarballUrl) {
  const isLocalTgz = packageName.startsWith('/') && packageName.endsWith('.tgz');
  
  if (!tarballUrl && !isLocalTgz) {
    return { obfuscationHits: [], obfuscationScore: 0 };
  }

  const safeTag = packageName.replace(/[^a-z0-9]/gi, '_');
  const tmpDir  = await fs.mkdtemp(path.join(os.tmpdir(), `sentinel-obf-${safeTag}-`));

  try {
    let tgzPath;
    if (isLocalTgz) {
      tgzPath = packageName;
    } else {
      // Download tarball
      tgzPath = path.join(tmpDir, 'pkg.tgz');
      const res = await axios.get(tarballUrl, { responseType: 'stream', timeout: 30_000 });
      await new Promise((resolve, reject) => {
        const w = createWriteStream(tgzPath);
        res.data.pipe(w);
        w.on('finish', resolve);
        w.on('error', reject);
      });
    }

    // Extract
    const extractDir = path.join(tmpDir, 'pkg');
    await fs.mkdir(extractDir);
    await tar.x({ file: tgzPath, cwd: extractDir, strip: 0 });

    // Scan
    const hits = [];
    await scanDir(extractDir, extractDir, hits);

    return { obfuscationHits: hits, obfuscationScore: calcScore(hits) };

  } catch (err) {
    console.error(`[Obfuscation] ${packageName}@${version}:`, err.message);
    return { obfuscationHits: [], obfuscationScore: 0, error: err.message };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
