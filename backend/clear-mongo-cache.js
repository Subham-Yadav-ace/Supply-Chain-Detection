import 'dotenv/config';
import { connectMongo } from './src/db/mongo.js';
import PackageCache from './src/db/models/PackageCache.js';
import mongoose from 'mongoose';

async function clear() {
  await connectMongo();
  await PackageCache.deleteMany({});
  console.log('Mongo PackageCache cleared.');
  mongoose.connection.close();
}
clear();
