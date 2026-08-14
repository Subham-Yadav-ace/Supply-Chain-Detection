import { Queue } from 'bullmq';
import Redis from 'ioredis';

// Need a dedicated Redis connection for the Queue
const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const scanQueue = new Queue('package-scan', { connection });

// Helper to gracefully close the queue connection
export async function closeQueue() {
  await scanQueue.close();
  connection.disconnect();
}
