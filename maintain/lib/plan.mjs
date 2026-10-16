// Decide per Dependabot PR: merge now, needs a click, failing, or wait.
// Limit from ADR 0044: patch/minor go live without a click only when the PR's
// checks are green AND the solution has a passing automated smoke test.
// Majors, unclear updates and PRs that change workflow files need a click
// (GITHUB_TOKEN may not merge changes under .github/workflows). So does an
// update the check after deploy already rolled back once (regression.mjs).

const STALE_DAYS = 3;

export function autoMergeGate({ requiredChecks, smokeResult }) {
  if (requiredChecks.length === 0) return { allowed: false, reason: "keine Pflicht-Checks definiert" };
  if (smokeResult === "failure") return { allowed: false, reason: "Funktionstest rot" };
  if (smokeResult !== "success") return { allowed: false, reason: "kein automatischer Funktionstest" };
  return { allowed: true, reason: null };
}

export function touchesWorkflows(files) {
  return files.some((f) => f.startsWith(".github/workflows/"));
}

/**
 * prs: [{ number, title, url, files, bump, checks: {state, failing, missing}, mergeable, createdAt, regression? }]
 * mergeable: true | false | null (null = GitHub still computing).
 * regression: reason string when the update was rolled back before (regressionOf).
 * Returns buckets; `merge` never contains two PRs that change the same file —
 * after one lockfile PR lands, Dependabot rebases the others and the next run
 * takes the next one.
 */
export function planMerges(prs, gate, now = Date.now()) {
  const plan = { merge: [], approvals: [], blocked: [], failing: [], waiting: [], stale: [] };
  const candidates = [];

  for (const pr of [...prs].sort((a, b) => a.number - b.number)) {
    // inGitHub: GITHUB_TOKEN cannot merge it, so no Inbox approval — a person merges in GitHub.
    const inGitHub = touchesWorkflows(pr.files);
    const isMajor = pr.bump === "major" || pr.bump === "unknown";
    if (isMajor && pr.checks.state === "fail") {
      // An OK would not help: the update needs code changes first.
      plan.blocked.push({ ...pr, kind: "deps_major", reason: "Checks rot" });
      continue;
    }
    if (isMajor) {
      plan.approvals.push({ ...pr, kind: "deps_major", inGitHub, reason: pr.bump === "major" ? "Major-Update" : "Update-Art unklar" });
      continue;
    }
    if (pr.checks.state === "fail") {
      plan.failing.push({ ...pr, reason: `Checks rot: ${pr.checks.failing.join(", ")}` });
      continue;
    }
    if (inGitHub) {
      plan.approvals.push({ ...pr, kind: "deps_update", inGitHub, reason: "ändert Workflows — Merge in GitHub" });
      continue;
    }
    if (pr.regression) {
      plan.approvals.push({ ...pr, kind: "deps_update", reason: pr.regression });
      continue;
    }
    if (pr.checks.state === "pending" || pr.mergeable !== true) {
      plan.waiting.push(pr);
      if (now - Date.parse(pr.createdAt) > STALE_DAYS * 86400000) plan.stale.push(pr);
      continue;
    }
    if (!gate.allowed) {
      plan.approvals.push({ ...pr, kind: "deps_update", reason: gate.reason });
      continue;
    }
    candidates.push(pr);
  }

  const taken = new Set();
  for (const pr of candidates) {
    if (pr.files.some((f) => taken.has(f))) {
      plan.waiting.push(pr);
      continue;
    }
    pr.files.forEach((f) => taken.add(f));
    plan.merge.push(pr);
  }
  return plan;
}

/**
 * Move PRs a person approved in the Business OS into `merge` — only when
 * green, mergeable and not overlapping a PR already merging this run.
 * Approved but not ready stays in `approvals` and is retried tomorrow.
 */
export function withApproved(plan, approvedNumbers) {
  const approved = new Set(approvedNumbers);
  const taken = new Set(plan.merge.flatMap((p) => p.files));
  const merge = [...plan.merge];
  const approvals = [];
  for (const pr of plan.approvals) {
    const ready = approved.has(pr.number) && !pr.inGitHub && pr.checks.state === "pass" &&
      pr.mergeable === true && !pr.files.some((f) => taken.has(f));
    if (ready) {
      pr.files.forEach((f) => taken.add(f));
      merge.push({ ...pr, approved: true });
    } else {
      approvals.push(approved.has(pr.number) ? { ...pr, reason: "freigegeben, wartet auf grüne Checks" } : pr);
    }
  }
  return { ...plan, merge, approvals };
}
