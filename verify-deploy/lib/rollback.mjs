// Roll back this run's merges (ADR 0044, check after deploy; Option C, Marco
// 2026-10-16): one new commit on the default branch carrying the tree from
// before the merges — git and production stay equal, no hosting token.
// Direct fast-forward instead of a revert PR: GITHUB_TOKEN may not open PRs
// in these repos, and the target tree was live and green minutes ago.
// Touches nothing but this run's merges: the first-parent chain from the
// head back to the base must be exactly them, else a person decides.
// GITHUB_TOKEN may not push changes under .github/workflows; the rollback
// never does, because such PRs are never merged by the run (plan.mjs).
import { regressionLines } from "../../maintain/lib/regression.mjs";

export function rollbackMessage(state, { reason, runUrl }) {
  const prs = state.merges.map((m) => `#${m.number}`).join(", ");
  return [
    `Revert Wartung: ${prs} (${reason})`,
    "",
    `Automatisch zurückgerollt vom Wartungslauf (ADR 0044): Stand ${state.base.slice(0, 7)} vor dem Merge wiederhergestellt.`,
    ...state.merges.map((m) => `- #${m.number} ${m.title}`),
    `Lauf: ${runUrl}`,
    "",
    ...regressionLines(state.merges),
  ].join("\n");
}

/** null when the branch holds exactly this run's merges on top of the base, else why not. */
async function foreignChange(gh, state) {
  const head = await gh.branchHead();
  if (head.branch !== state.branch || head.sha !== state.head) return `${state.branch} hat sich seit dem Merge bewegt`;
  let expected = state.head;
  for (const merge of [...state.merges].reverse()) {
    if (merge.sha !== expected) return "fremde Commits zwischen den Merges";
    [expected] = (await gh.gitCommit(merge.sha)).parents;
  }
  return expected === state.base ? null : "fremde Commits zwischen den Merges";
}

/**
 * Returns { done: false, reason } or { done: true, sha, lockError } —
 * lockError when the regression tag (regression.mjs) could not be set.
 */
export async function rollBack(gh, state, { reason, runUrl, tag }) {
  const foreign = await foreignChange(gh, state);
  if (foreign) return { done: false, reason: foreign };

  const { tree } = await gh.gitCommit(state.base);
  const sha = await gh.createCommit({ message: rollbackMessage(state, { reason, runUrl }), tree, parents: [state.head] });
  try {
    await gh.fastForward(state.branch, sha);
  } catch (e) {
    return { done: false, reason: `Rollback-Commit nicht übernommen: ${e.message}`.slice(0, 200) };
  }
  try {
    await gh.createTag(tag, sha);
    return { done: true, sha, lockError: null };
  } catch (e) {
    return { done: true, sha, lockError: e.message.slice(0, 120) };
  }
}
