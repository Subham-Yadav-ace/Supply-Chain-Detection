import axios from 'axios';

const REGISTRY_BASE = 'https://registry.npmjs.org';
// In-memory cache (TTL: 1 hour) — replaced by Redis in Part 4
const memCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;

async function fetchWithCache(url) {
  const cached = memCache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const res = await axios.get(url, {
    timeout: 12000,
    headers: { Accept: 'application/json' },
  });

  memCache.set(url, { data: res.data, ts: Date.now() });
  return res.data;
}

/** Full package metadata (all versions, maintainers, publish times) */
export async function fetchPackageMetadata(packageName) {
  const enc = encodeURIComponent(packageName);
  return fetchWithCache(`${REGISTRY_BASE}/${enc}`);
}

/** Single version metadata */
export async function fetchVersionMetadata(packageName, version) {
  const enc = encodeURIComponent(packageName);
  return fetchWithCache(`${REGISTRY_BASE}/${enc}/${version}`);
}

/** Latest version string */
export async function fetchLatestVersion(packageName) {
  const meta = await fetchPackageMetadata(packageName);
  return meta['dist-tags']?.latest || Object.keys(meta.versions || {}).pop();
}

/**
 * Extract structured info needed by static analysis.
 * @returns {{ currentMaintainers, prevMaintainers, publishTime, prevPublishTime,
 *             latestVersion, allVersions, tarballUrl }}
 */
export function extractMaintainerInfo(meta, version) {
  const versionKeys = Object.keys(meta.versions || {});
  const resolvedVersion = version || meta['dist-tags']?.latest;
  const versionData = meta.versions?.[resolvedVersion] || {};

  const currentMaintainers = versionData._npmUser
    ? [versionData._npmUser.name]
    : (versionData.maintainers || []).map(m => m.name);

  const prevIdx = versionKeys.indexOf(resolvedVersion) - 1;
  const prevVersion = prevIdx >= 0 ? versionKeys[prevIdx] : null;
  const prevData = prevVersion ? meta.versions[prevVersion] : null;
  const prevMaintainers = prevData?._npmUser
    ? [prevData._npmUser.name]
    : (prevData?.maintainers || []).map(m => m.name);

  return {
    currentMaintainers,
    prevMaintainers,
    publishTime:     meta.time?.[resolvedVersion] || null,
    prevPublishTime: prevVersion ? meta.time?.[prevVersion] : null,
    latestVersion:   meta['dist-tags']?.latest,
    allVersions:     versionKeys,
    tarballUrl:      versionData.dist?.tarball || null,
  };
}
