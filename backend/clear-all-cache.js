import 'dotenv/config';
import { connectMongo } from './src/db/mongo.js';
import PackageCache from './src/db/models/PackageCache.js';
import mongoose from 'mongoose';
import Redis from 'ioredis';

async function clear() {
  await connectMongo();
  await PackageCache.deleteMany({});
  console.log('Mongo PackageCache cleared.');
  
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  await redis.flushall();
  console.log('Redis cache cleared.');
  
  mongoose.connection.close();
  redis.disconnect();
}
clear();
