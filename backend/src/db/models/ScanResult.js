import mongoose from 'mongoose';

const PackageResultSchema = new mongoose.Schema({
  name: { type: String, required: true },
  version: { type: String, required: true },
  cached: { type: Boolean, default: false },
  riskScore: { type: Number, default: null }, // from AI (Stage 2)
  riskLevel: { type: String, default: null }, // from AI (Stage 2)
  explanation: { type: String, default: null }, // from AI (Stage 2)
  redFlags: { type: [String], default: [] }, // from AI (Stage 2)
  sandboxFindings: { type: Object, default: {} },
  staticFindings: { type: Object, default: {} },
}, { _id: false }); // subdocument, no need for separate _id

const ScanResultSchema = new mongoose.Schema({
  scanId: { type: String, required: true, unique: true },
  input: { type: String, required: true }, // package.json or packageName
  status: { type: String, enum: ['queued', 'running', 'complete', 'error'], default: 'queued' },
  totalPackages: { type: Number, default: 0 },
  completedPackages: { type: Number, default: 0 },
  dependencyTree: [{
    name: String,
    version: String,
    depth: Number,
    parent: String,
    _id: false
  }],
  results: [PackageResultSchema],
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null }
});

// Index for fast lookups by scanId
ScanResultSchema.index({ scanId: 1 });

export default mongoose.model('ScanResult', ScanResultSchema);
