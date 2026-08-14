import mongoose from 'mongoose';

const PackageCacheSchema = new mongoose.Schema({
  name: { type: String, required: true },
  version: { type: String, required: true },
  result: { type: Object, required: true }, // The full PackageResult (sandbox + static + AI)
  cachedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true }
});

// Compound index for fast exact-match lookups
PackageCacheSchema.index({ name: 1, version: 1 }, { unique: true });
// TTL index to automatically delete expired documents
PackageCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('PackageCache', PackageCacheSchema);
