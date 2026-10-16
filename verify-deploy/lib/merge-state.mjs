// Parse the maintain output merge-state. It drives a write to the default
// branch, so the shape is checked strictly instead of trusted.

const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^[A-Za-z0-9._/-]+$/;

/** null when nothing was merged (empty input), else { branch, base, head, merges }. */
export function parseMergeState(text) {
  if (!text.trim()) return null;
  const state = JSON.parse(text);
  const fail = (what) => {
    throw new Error(`merge-state: ${what}`);
  };
  if (typeof state.branch !== "string" || !BRANCH.test(state.branch)) fail("branch missing");
  if (!SHA.test(state.base ?? "") || !SHA.test(state.head ?? "")) fail("base/head must be commit shas");
  if (!Array.isArray(state.merges) || state.merges.length === 0) fail("merges missing");
  for (const m of state.merges) {
    if (!Number.isInteger(m.number) || !SHA.test(m.sha ?? "") || typeof m.title !== "string") {
      fail("each merge needs number, sha and title");
    }
    if (m.updates !== undefined && !Array.isArray(m.updates)) fail("updates must be a list");
  }
  return state;
}
