import { distance } from 'fastest-levenshtein';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load bundled top-packages list (shipped with the project — no network needed)
const TOP_PACKAGES = JSON.parse(
  readFileSync(path.join(__dirname, 'data', 'top-packages.json'), 'utf-8')
);

const DISTANCE_THRESHOLD = 2;

/**
 * Check if a package name looks like a typosquat of a popular package.
 *
 * @param {string} packageName
 * @returns {{ flagged, typosquatScore, similarTo, distance, isPopularPackage }}
 */
export function checkTyposquat(packageName) {
  // Exact match — it IS the popular package
  if (TOP_PACKAGES.includes(packageName)) {
    return {
      flagged: false,
      typosquatScore: 0,
      similarTo: null,
      distance: 0,
      isPopularPackage: true,
    };
  }

  let closestPackage = null;
  let minDist = Infinity;

  for (const popular of TOP_PACKAGES) {
    // Skip if lengths are too different — can't be within threshold
    if (Math.abs(packageName.length - popular.length) > DISTANCE_THRESHOLD) continue;

    const d = distance(packageName, popular);
    if (d < minDist) {
      minDist = d;
      closestPackage = popular;
      if (minDist === 1) break; // Can't go lower, short-circuit
    }
  }

  const flagged = minDist <= DISTANCE_THRESHOLD;

  // Score: distance=1 → 0.9, distance=2 → 0.5, distance>2 → 0
  const typosquatScore = flagged
    ? parseFloat((1 - (minDist - 1) / DISTANCE_THRESHOLD * 0.5).toFixed(2))
    : 0;

  return {
    flagged,
    typosquatScore,
    similarTo: flagged ? closestPackage : null,
    distance: minDist,
    isPopularPackage: false,
  };
}
