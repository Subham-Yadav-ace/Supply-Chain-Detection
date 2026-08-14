import { Redis } from 'ioredis';
import PackageCache from '../db/models/PackageCache.js';

export let redisClient;

const CACHE_TTL_DAYS = parseInt(process.env.CACHE_TTL_DAYS) || 7;
const CACHE_TTL_SECONDS = CACHE_TTL_DAYS * 24 * 60 * 60;

export async function initRedis() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  redisClient = new Redis(url, {
    maxRetriesPerRequest: null, // needed for BullMQ
  });

  redisClient.on('error', (err) => {
    console.error('[Redis] Error:', err.message);
  });

  await new Promise((resolve) => {
    redisClient.once('ready', () => {
      console.log(`[Redis] Connected to ${url}`);
      resolve();
    });
  });
}

/**
 * Get cached package result. Checks Redis first, falls back to Mongo.
 */
export async function getCache(name, version) {
  const key = `pkg:${name}@${version}`;
  
  try {
    // 1. Check Redis
    const cachedStr = await redisClient.get(key);
    if (cachedStr) {
      return JSON.parse(cachedStr);
    }

    // 2. Fallback to Mongo
    const doc = await PackageCache.findOne({ name, version }).lean();
    if (doc) {
      // Re-populate Redis (lazy load)
      await redisClient.set(key, JSON.stringify(doc.result), 'EX', CACHE_TTL_SECONDS);
      return doc.result;
    }

    return null;
  } catch (err) {
    console.warn(`[Redis] getCache error for ${key}:`, err.message);
    return null; // Fallback to not cached on error
  }
}

/**
 * Save package result to both Redis and Mongo.
 */
export async function setCache(name, version, result) {
  const key = `pkg:${name}@${version}`;
  
  try {
    // 1. Save to Redis
    await redisClient.set(key, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);

    // 2. Save to Mongo (upsert)
    const expiresAt = new Date(Date.now() + CACHE_TTL_SECONDS * 1000);
    await PackageCache.findOneAndUpdate(
      { name, version },
      { name, version, result, expiresAt, cachedAt: new Date() },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.warn(`[Redis] setCache error for ${key}:`, err.message);
  }
}

/**
 * Manually bust cache for a package
 */
export async function invalidateCache(name, version) {
  const key = `pkg:${name}@${version}`;
  try {
    await redisClient.del(key);
    await PackageCache.deleteOne({ name, version });
  } catch (err) {
    console.warn(`[Redis] invalidateCache error for ${key}:`, err.message);
  }
}
