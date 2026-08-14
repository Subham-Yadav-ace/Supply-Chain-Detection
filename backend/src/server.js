import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { connectMongo } from './db/mongo.js';
import { initRedis } from './cache/redisCache.js';
import { startWorker } from './queue/worker.js';
import scanRoutes from './routes/scan.js';
import healthRoutes from './routes/health.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/scan', scanRoutes);
app.use('/api/health', healthRoutes);

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Global error handler ────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    await connectMongo();
    await initRedis();
    startWorker();

    const server = app.listen(PORT, () => {
      console.log(`\n🛡️  SentinelChain backend running on http://localhost:${PORT}`);
      console.log(`   MongoDB: ${process.env.MONGO_URI}`);
      console.log(`   Redis:   ${process.env.REDIS_URL}`);
      console.log(`   Mode:    ${process.env.NODE_ENV || 'development'}\n`);
    });

    // ─── Graceful shutdown ────────────────────────────────────────────────────
    const shutdown = (signal) => {
      console.log(`\n[${signal}] Shutting down gracefully...`);
      server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

  } catch (err) {
    console.error('[Bootstrap Failed]', err.message);
    process.exit(1);
  }
}

bootstrap();
