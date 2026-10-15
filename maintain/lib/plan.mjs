// Decide per Dependabot PR: merge now, needs a click, failing, or wait.
// Limit from ADR 0044: patch/minor go live without a click only when the PR's
// checks are green AND the solution has a passing automated smoke test.
// Majors, unclear updates and PRs that change workflow files need a click
// (GITHUB_TOKEN may not merge changes under .github/workflows).

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
 * prs: [{ number, title, url, files, bump, checks: {state, failing, missing}, mergeable, createdAt }]
 * mergeable: true | false | null (null = GitHub still computing).
 * Returns buckets; `merge` never contains two PRs that change the same file —
 * after one lockfile PR lands, Dependabot rebases the others and the next run
 * takes the next one.
 */
export function planMerges(prs, gate, now = Date.now()) {
  const plan = { merge: [], approvals: [], failing: [], waiting: [], stale: [] };
  const candidates = [];

  for (const pr of [...prs].sort((a, b) => a.number - b.number)) {
    const isMajor = pr.bump === "major" || pr.bump === "unknown";
    if (isMajor) {
      plan.approvals.push({ ...pr, kind: "deps_major", reason: pr.bump === "major" ? "Major-Update" : "Update-Art unklar" });
      continue;
    }
    if (pr.checks.state === "fail") {
      plan.failing.push({ ...pr, reason: `Checks rot: ${pr.checks.failing.join(", ")}` });
      continue;
    }
    if (touchesWorkflows(pr.files)) {
      plan.approvals.push({ ...pr, kind: "deps_update", reason: "ändert Workflows — Merge in GitHub" });
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
