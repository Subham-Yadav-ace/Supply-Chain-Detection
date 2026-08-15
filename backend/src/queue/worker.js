import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { runSandbox } from '../sandbox/runContainer.js';
import { checkTyposquat } from '../static-analysis/typosquat.js';
import { analyzeObfuscation } from '../static-analysis/obfuscation.js';
import { checkMetadataFlags } from '../static-analysis/metadataFlags.js';
import { fetchVersionMetadata } from '../ingestion/npmRegistry.js';
import { getCache, setCache } from '../cache/redisCache.js';
import ScanResult from '../db/models/ScanResult.js';
// AI Scoring — imported gracefully, falls back if module or key is missing
import { scorePackage } from '../ai-scoring/geminiClient.js';

let worker;

export function startWorker() {
  const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });

  worker = new Worker('package-scan', async (job) => {
    const { scanId, name, version } = job.data;
    const pkgSpec = `${name}@${version}`;
    console.log(`[Worker] Starting job for ${pkgSpec} (scanId: ${scanId})`);

    try {
      // 1. Double check cache just in case
      let result = await getCache(name, version);

      if (!result) {
        // 2. Fetch basic metadata for static analysis (catch 404s for local/missing packages)
        const verMeta = await fetchVersionMetadata(name, version).catch(() => null);
        let tarballUrl = verMeta?.dist?.tarball;
        let testName = name;

        // Support testing the malicious demo package locally
        if (name === 'malicious-demo-package') {
          testName = '/home/subham-yadav/Desktop/SentinelChain/test-packages/malicious-demo-package/malicious-demo-package-1.0.0.tgz';
          tarballUrl = undefined;
        }

        // 3. Run parallel analysis
        const [sandboxFindings, obfuscationFindings, metadataFlags] = await Promise.all([
          runSandbox(testName, version),
          analyzeObfuscation(testName, version, tarballUrl),
          checkMetadataFlags(name, version)
        ]);

        const typosquatResult = checkTyposquat(name);

        const staticFindings = {
          typosquat: typosquatResult,
          obfuscation: obfuscationFindings,
          metadata: metadataFlags
        };

        // 4. AI Scoring (Stage 2)
        const aiScore = await scorePackage(sandboxFindings, staticFindings, verMeta);

        result = {
          name,
          version,
          cached: false,
          riskScore: aiScore.riskScore,
          riskLevel: aiScore.riskLevel,
          explanation: aiScore.explanation,
          redFlags: aiScore.redFlags,
          sandboxFindings,
          staticFindings
        };

        // 5. Cache result
        await setCache(name, version, result);
      } else {
        console.log(`[Worker] Cache hit inside worker for ${pkgSpec}`);
      }

      // 6. Update parent ScanResult
      await ScanResult.findOneAndUpdate(
        { scanId },
        {
          $inc: { completedPackages: 1 },
          $push: { results: result }
        }
      );

      // Check if this was the last package
      const updatedScan = await ScanResult.findOne({ scanId }).lean();
      if (updatedScan && updatedScan.completedPackages >= updatedScan.totalPackages) {
        await ScanResult.findOneAndUpdate(
          { scanId },
          { status: 'complete', completedAt: new Date() }
        );
        console.log(`[Worker] Scan ${scanId} complete.`);
      }

      return { success: true };

    } catch (err) {
      console.error(`[Worker] Error processing ${pkgSpec}:`, err.message);
      
      // Update scan doc with error result for this package
      await ScanResult.findOneAndUpdate(
        { scanId },
        {
          $inc: { completedPackages: 1 },
          $push: { 
            results: { 
              name, 
              version, 
              riskScore: -1, 
              riskLevel: 'error',
              explanation: `Analysis failed: ${err.message}` 
            } 
          }
        }
      );
      
      // Check if this was the last package (even on error)
      const updatedScan = await ScanResult.findOne({ scanId }).lean();
      if (updatedScan && updatedScan.completedPackages >= updatedScan.totalPackages) {
        await ScanResult.findOneAndUpdate(
          { scanId },
          { status: 'complete', completedAt: new Date() }
        );
        console.log(`[Worker] Scan ${scanId} complete (with some errors).`);
      }
      
      // We don't throw, we just mark it as an error result so the overall scan can finish
      return { success: false, error: err.message };
    }
  }, { 
    connection,
    concurrency: parseInt(process.env.WORKER_CONCURRENCY) || 1
  });

  worker.on('error', err => {
    console.error('[Worker] Fatal error:', err.message);
  });

  console.log('[Worker] Started listening for jobs.');
}

export async function stopWorker() {
  if (worker) {
    await worker.close();
  }
}
