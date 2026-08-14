import { fetchPackageMetadata, extractMaintainerInfo } from '../ingestion/npmRegistry.js';

const VERSION_JUMP_THRESHOLD     = 3;    // major version jump ≥ this is suspicious
const PUBLISH_GAP_THRESHOLD_DAYS = 365;  // 1 year gap before sudden activity
const NEW_ACCOUNT_DAYS           = 30;   // maintainer account age < 30 days

/**
 * Inspect npm registry metadata for account-takeover and abandonment signals.
 *
 * @param {string} packageName
 * @param {string|null} version  — pass null to use latest
 * @returns {{ newMaintainer, versionJumpFlag, publishGapDays, newAccount, details, error? }}
 */
export async function checkMetadataFlags(packageName, version) {
  try {
    const meta     = await fetchPackageMetadata(packageName);
    const resolved = version || meta['dist-tags']?.latest;
    const info     = extractMaintainerInfo(meta, resolved);

    const flags = {
      newMaintainer:    false,
      versionJumpFlag:  false,
      publishGapDays:   null,
      newAccount:       false,
      details:          {},
    };

    // ── New maintainer (account-takeover signal) ──────────────────────────────
    if (info.currentMaintainers.length && info.prevMaintainers.length) {
      const newOnes = info.currentMaintainers.filter(m => !info.prevMaintainers.includes(m));
      if (newOnes.length) {
        flags.newMaintainer = true;
        flags.details.newMaintainers  = newOnes;
        flags.details.prevMaintainers = info.prevMaintainers;
      }
    }

    // ── Major version jump ────────────────────────────────────────────────────
    const versionKeys = info.allVersions;
    const vIdx = versionKeys.indexOf(resolved);
    if (vIdx > 0) {
      const prev = parseSemver(versionKeys[vIdx - 1]);
      const curr = parseSemver(resolved);
      if (prev && curr) {
        const majorJump = curr.major - prev.major;
        if (majorJump >= VERSION_JUMP_THRESHOLD) {
          flags.versionJumpFlag = true;
          flags.details.majorJump    = majorJump;
          flags.details.fromVersion  = versionKeys[vIdx - 1];
          flags.details.toVersion    = resolved;
        }
      }
    }

    // ── Publish gap ───────────────────────────────────────────────────────────
    if (info.publishTime && info.prevPublishTime) {
      const gapMs   = new Date(info.publishTime) - new Date(info.prevPublishTime);
      const gapDays = Math.floor(gapMs / 86_400_000);
      flags.publishGapDays = gapDays;
      if (gapDays >= PUBLISH_GAP_THRESHOLD_DAYS) {
        flags.details.publishGapDays = gapDays;
      }
    }

    // ── New maintainer account age ────────────────────────────────────────────
    // npm doesn't expose account creation date in the public registry API,
    // but we can approximate by looking at the user's first publish across all packages.
    // For the hackathon, we flag this based on maintainer presence in registry metadata.
    // If the current maintainer doesn't appear in earlier versions at all, treat as new.
    if (flags.newMaintainer) {
      const allPrevMaintainers = new Set();
      for (const v of versionKeys.slice(0, vIdx)) {
        const vData = meta.versions?.[v];
        const maintainers = vData?._npmUser
          ? [vData._npmUser.name]
          : (vData?.maintainers || []).map(m => m.name);
        maintainers.forEach(m => allPrevMaintainers.add(m));
      }
      const brandNew = flags.details.newMaintainers?.filter(m => !allPrevMaintainers.has(m));
      if (brandNew?.length) {
        flags.newAccount = true;
        flags.details.brandNewMaintainers = brandNew;
      }
    }

    return flags;

  } catch (err) {
    console.error(`[MetadataFlags] ${packageName}@${version}:`, err.message);
    return {
      newMaintainer: false, versionJumpFlag: false,
      publishGapDays: null, newAccount: false,
      error: err.message,
    };
  }
}

function parseSemver(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}
