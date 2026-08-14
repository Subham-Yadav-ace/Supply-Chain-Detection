import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import ScanResult from '../db/models/ScanResult.js';
import { resolveTree } from '../ingestion/resolveTree.js';
import { getCache } from '../cache/redisCache.js';
import { scanQueue } from '../queue/bullmq.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ─── POST /api/scan ───────────────────────────────────────────────────────────
router.post('/', upload.single('packageJson'), async (req, res) => {
  try {
    let packageJsonContent = null;
    let packageName = null;

    if (req.file) {
      // File upload path
      const raw = req.file.buffer.toString('utf-8');
      packageJsonContent = JSON.parse(raw);
      if (!packageJsonContent.dependencies && !packageJsonContent.devDependencies) {
        return res.status(400).json({ error: 'Uploaded file must contain a dependencies field' });
      }
    } else if (req.body.packageName) {
      // Single package name path
      packageName = req.body.packageName.trim();
    } else {
      return res.status(400).json({ error: 'Provide either a package.json file or a packageName' });
    }

    const scanId = uuidv4();
    const input = packageName || JSON.stringify(packageJsonContent);

    // Resolve dependency tree
    const { tree, uniquePackages } = await resolveTree(packageJsonContent, packageName);

    // Separate cached vs uncached packages
    const cachedPackages = [];
    const uncachedPackages = [];

    for (const pkg of uniquePackages) {
      const cached = await getCache(pkg.name, pkg.version);
      if (cached) {
        cachedPackages.push({ ...pkg, cached: true, result: cached });
      } else {
        uncachedPackages.push(pkg);
      }
    }

    // Create scan document
    const scan = await ScanResult.create({
      scanId,
      input,
      status: 'queued',
      totalPackages: uniquePackages.length,
      completedPackages: cachedPackages.length,
      dependencyTree: tree,
      results: cachedPackages.map(p => p.result),
    });

    // Enqueue uncached packages
    for (const pkg of uncachedPackages) {
      await scanQueue.add('scan-package', { scanId, name: pkg.name, version: pkg.version });
    }

    // If everything was cached, mark complete immediately
    if (uncachedPackages.length === 0) {
      await ScanResult.findOneAndUpdate({ scanId }, { status: 'complete', completedAt: new Date() });
    }

    res.status(202).json({
      scanId,
      totalPackages: uniquePackages.length,
      cachedPackages: cachedPackages.length,
      queuedPackages: uncachedPackages.length,
    });
  } catch (err) {
    console.error('[POST /api/scan]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/scan/:scanId ────────────────────────────────────────────────────
router.get('/:scanId', async (req, res) => {
  try {
    const scan = await ScanResult.findOne({ scanId: req.params.scanId }).lean();
    if (!scan) return res.status(404).json({ error: 'Scan not found' });
    res.json(scan);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/scan/:scanId/stream (SSE) ──────────────────────────────────────
router.get('/:scanId/stream', async (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.flushHeaders();

  const scanId = req.params.scanId;
  const POLL_INTERVAL = 1500;

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const interval = setInterval(async () => {
    try {
      const scan = await ScanResult.findOne({ scanId }).lean();
      if (!scan) {
        send('error', { message: 'Scan not found' });
        clearInterval(interval);
        return res.end();
      }

      send('progress', {
        status: scan.status,
        completedPackages: scan.completedPackages,
        totalPackages: scan.totalPackages,
        latestResults: scan.results?.slice(-5),
      });

      if (scan.status === 'complete' || scan.status === 'error') {
        send('complete', { scanId, status: scan.status });
        clearInterval(interval);
        res.end();
      }
    } catch (err) {
      send('error', { message: err.message });
      clearInterval(interval);
      res.end();
    }
  }, POLL_INTERVAL);

  req.on('close', () => clearInterval(interval));
});

export default router;
