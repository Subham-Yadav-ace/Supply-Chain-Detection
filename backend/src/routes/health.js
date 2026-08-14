import { Router } from 'express';
import mongoose from 'mongoose';
import { redisClient } from '../cache/redisCache.js';
import Docker from 'dockerode';

const router = Router();

// ─── GET /api/health ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const status = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      mongo: false,
      redis: false,
      docker: false,
    },
  };

  // MongoDB
  try {
    status.services.mongo = mongoose.connection.readyState === 1;
  } catch (_) {}

  // Redis
  try {
    const pong = await redisClient.ping();
    status.services.redis = pong === 'PONG';
  } catch (_) {}

  // Docker daemon
  try {
    const docker = new Docker();
    await docker.ping();
    status.services.docker = true;
  } catch (_) {}

  const allHealthy = Object.values(status.services).every(Boolean);
  status.status = allHealthy ? 'ok' : 'degraded';

  res.status(allHealthy ? 200 : 503).json(status);
});

export default router;
