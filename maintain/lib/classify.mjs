// Classify a Dependabot PR as patch | minor | major | unknown.
// unknown is treated like major by the planner: when in doubt, a human clicks.

const RANK = { patch: 1, minor: 2, major: 3 };

function parseVersion(text) {
  const m = String(text).replace(/^v/i, "").match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return m ? m.slice(1, 4).map((n) => (n === undefined ? 0 : Number(n))) : null;
}

/** Semver bump between two versions; 0.x treats a minor bump as breaking. */
export function bumpOf(from, to) {
  const a = parseVersion(from);
  const b = parseVersion(to);
  if (!a || !b) return null;
  if (a[0] !== b[0]) return "major";
  if (a[0] === 0 && a[1] !== b[1]) return "major";
  if (a[1] !== b[1]) return "minor";
  return "patch";
}

function highest(bumps) {
  return bumps.filter(Boolean).reduce((best, b) => (!best || RANK[b] > RANK[best] ? b : best), null);
}

/**
 * Sources, most reliable first:
 *  1. `update-type: version-update:semver-*` lines in the commit message
 *     (Dependabot writes them for direct dependencies),
 *  2. "from X to Y" in the title (single-dependency PRs),
 *  3. "Updates `pkg` from X to Y" lines in the body (grouped PRs).
 * The highest bump across all sources wins.
 */
export function classifyUpdate({ title = "", body = "", commitMessage = "" }) {
  const bumps = [];
  for (const m of commitMessage.matchAll(/update-type:\s*version-update:semver-(major|minor|patch)/g)) {
    bumps.push(m[1]);
  }
  const titlePair = title.match(/\bfrom\s+(\S+)\s+to\s+(\S+)/i);
  if (titlePair) bumps.push(bumpOf(titlePair[1], titlePair[2]));
  for (const m of body.matchAll(/^Updates `[^`]+` from (\S+) to (\S+)/gm)) {
    bumps.push(bumpOf(m[1], m[2]));
  }
  return highest(bumps) ?? "unknown";
}
