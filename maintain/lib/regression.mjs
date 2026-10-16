// Regression lock (ADR 0044, check after deploy): when verify-deploy rolls
// updates back, its rollback commit names every bad version on a line
// "ops-regression: pkg@version" (or the PR title when no version is
// readable) and is tagged ops-regression/<run>. Dependabot then reopens the
// same update; the maintenance run sends it to a click instead of merging it
// again. Deleting the tag lifts the lock.

const UPDATE_LINE = /^ops-regression: (.+)$/gm;
const TITLE_LINE = /^ops-regression-title: (.+)$/gm;

const cleanVersion = (v) => v.replace(/[.,;:]+$/, "");

/** "pkg@version" per updated dependency: title of single PRs, "Updates `x` from … to …" lines of grouped PRs. */
export function updatesOf({ title = "", body = "" }) {
  const updates = new Set();
  const single = title.match(/\bbump\s+(\S+)\s+from\s+\S+\s+to\s+(\S+)/i);
  if (single) updates.add(`${single[1]}@${cleanVersion(single[2])}`);
  for (const m of body.matchAll(/^Updates `([^`]+)` from \S+ to (\S+)/gm)) {
    updates.add(`${m[1]}@${cleanVersion(m[2])}`);
  }
  return [...updates];
}

/** Lines for the rollback commit message, one per rolled-back version. */
export function regressionLines(prs) {
  return prs.flatMap((pr) =>
    pr.updates?.length
      ? pr.updates.map((u) => `ops-regression: ${u}`)
      : [`ops-regression-title: ${pr.title}`],
  );
}

/** Collect the locked versions and titles from rollback commit messages. */
export function parseRegressions(messages) {
  const updates = new Set();
  const titles = new Set();
  for (const message of messages) {
    for (const m of message.matchAll(UPDATE_LINE)) updates.add(m[1].trim());
    for (const m of message.matchAll(TITLE_LINE)) titles.add(m[1].trim());
  }
  return { updates, titles };
}

/** Reason why this PR may not merge without a click, or null. pr.updates from updatesOf(). */
export function regressionOf(pr, regressed) {
  const hit = (pr.updates ?? []).find((u) => regressed.updates.has(u));
  if (hit) return `zurückgerollt nach Regression: ${hit}`;
  if (regressed.titles.has(pr.title)) return "zurückgerollt nach Regression (gleicher Titel)";
  return null;
}
