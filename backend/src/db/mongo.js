import mongoose from 'mongoose';

export async function connectMongo() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/sentinelchain';
  
  try {
    await mongoose.connect(uri);
    console.log(`[MongoDB] Connected to ${uri}`);
  } catch (err) {
    console.error('[MongoDB] Connection error:', err.message);
    // Don't exit immediately, let server retry logic handle it if needed
    throw err;
  }

  mongoose.connection.on('error', err => {
    console.error('[MongoDB] Runtime error:', err.message);
  });
  
  mongoose.connection.on('disconnected', () => {
    console.warn('[MongoDB] Disconnected');
  });
}
