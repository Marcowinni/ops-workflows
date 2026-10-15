// Evaluate the CI result of a PR head commit from check runs + commit statuses.
// state: pass | fail | pending. Auto-merge needs pass AND every required check
// present with success — a repo without named checks never auto-merges.

const FAILED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"]);
const PASSED = new Set(["success", "neutral", "skipped"]);

/** Latest entry per name: reruns leave older runs with the same name behind. */
function latestByName(entries, nameOf, orderOf) {
  const latest = new Map();
  for (const e of entries) {
    const prev = latest.get(nameOf(e));
    if (!prev || orderOf(e) > orderOf(prev)) latest.set(nameOf(e), e);
  }
  return latest;
}

export function evaluateChecks({ checkRuns = [], statuses = [], required = [] }) {
  const results = new Map();
  for (const [name, run] of latestByName(checkRuns, (r) => r.name, (r) => r.id ?? 0)) {
    if (run.status !== "completed") results.set(name, "pending");
    else if (FAILED.has(run.conclusion)) results.set(name, "fail");
    else if (PASSED.has(run.conclusion)) results.set(name, run.conclusion === "success" ? "pass" : "neutral");
    else results.set(name, "pending");
  }
  for (const [name, s] of latestByName(statuses, (s) => s.context, (s) => Date.parse(s.updated_at ?? 0) || 0)) {
    results.set(name, s.state === "success" ? "pass" : s.state === "pending" ? "pending" : "fail");
  }

  const failing = [...results].filter(([, r]) => r === "fail").map(([n]) => n);
  const missing = required.filter((name) => results.get(name) !== "pass");
  const anyPending = [...results.values()].includes("pending");

  let state = "pass";
  if (failing.length > 0) state = "fail";
  else if (anyPending || missing.length > 0) state = "pending";
  return { state, failing, missing };
}
