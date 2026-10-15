import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateChecks } from "../maintain/lib/checks.mjs";
import { bumpOf, classifyUpdate } from "../maintain/lib/classify.mjs";
import { autoMergeGate, planMerges, withApproved } from "../maintain/lib/plan.mjs";
import { buildReport } from "../maintain/lib/report.mjs";
import { applySchedule, isSecurityPr, pendingFor } from "../maintain/lib/schedule.mjs";

test("bumpOf: semver incl. 0.x and action tags", () => {
  assert.equal(bumpOf("16.3.6", "16.3.8"), "patch");
  assert.equal(bumpOf("1.2.1", "1.3.0"), "minor");
  assert.equal(bumpOf("15.1.0", "16.0.0"), "major");
  assert.equal(bumpOf("0.35.4", "0.35.5"), "patch");
  assert.equal(bumpOf("0.35.4", "0.36.0"), "major");
  assert.equal(bumpOf("4", "5"), "major");
  assert.equal(bumpOf("v4.1.0", "v4.2.0"), "minor");
  assert.equal(bumpOf("abc", "1.0.0"), null);
});

test("classifyUpdate: commit metadata, title, grouped body; highest wins; unknown fallback", () => {
  assert.equal(classifyUpdate({ title: "chore(deps): bump sharp from 0.35.4 to 0.35.5" }), "patch");
  assert.equal(classifyUpdate({
    title: "chore(deps): bump next from 16.3.6 to 16.3.8",
    commitMessage: "updated-dependencies:\n- dependency-name: next\n  update-type: version-update:semver-patch\n",
  }), "patch");
  assert.equal(classifyUpdate({
    title: "chore(deps): bump the minor-and-patch group with 2 updates",
    body: "Updates `a` from 1.0.0 to 1.1.0\n- notes\nUpdates `b` from 2.0.0 to 3.0.0\n",
  }), "major");
  assert.equal(classifyUpdate({
    title: "bump the minor-and-patch group with 1 update",
    commitMessage: "update-type: version-update:semver-minor\nupdate-type: version-update:semver-major",
  }), "major");
  assert.equal(classifyUpdate({ title: "chore(deps): bump something" }), "unknown");
});

test("evaluateChecks: pass, fail, pending, required present, latest rerun wins, statuses", () => {
  const run = (id, name, conclusion, status = "completed") => ({ id, name, status, conclusion });
  assert.deepEqual(
    evaluateChecks({ checkRuns: [run(1, "Typecheck + Lint", "success"), run(2, "skip", "skipped")], required: ["Typecheck + Lint"] }),
    { state: "pass", failing: [], missing: [] },
  );
  assert.equal(evaluateChecks({ checkRuns: [run(1, "Typecheck + Lint", "failure")], required: [] }).state, "fail");
  assert.equal(evaluateChecks({ checkRuns: [run(1, "build", null, "in_progress")] }).state, "pending");
  assert.deepEqual(evaluateChecks({ checkRuns: [run(1, "build", "success")], required: ["Typecheck + Lint"] }).missing, ["Typecheck + Lint"]);
  assert.equal(evaluateChecks({ checkRuns: [run(1, "ci", "failure"), run(2, "ci", "success")], required: ["ci"] }).state, "pass");
  assert.equal(evaluateChecks({ statuses: [{ context: "Vercel", state: "error", updated_at: "2026-10-15T10:00:00Z" }] }).state, "fail");
});

const green = { state: "pass", failing: [], missing: [] };
const pr = (number, extra = {}) => ({
  number, title: `PR ${number}`, url: `https://github.com/o/r/pull/${number}`, sha: `s${number}`,
  files: ["pnpm-lock.yaml"], bump: "patch", checks: green, mergeable: true, createdAt: new Date().toISOString(), ...extra,
});
const open = { allowed: true, reason: null };

test("autoMergeGate: needs required checks and a green smoke test", () => {
  assert.equal(autoMergeGate({ requiredChecks: [], smokeResult: "success" }).allowed, false);
  assert.equal(autoMergeGate({ requiredChecks: ["ci"], smokeResult: "none" }).reason, "kein automatischer Funktionstest");
  assert.equal(autoMergeGate({ requiredChecks: ["ci"], smokeResult: "failure" }).reason, "Funktionstest rot");
  assert.equal(autoMergeGate({ requiredChecks: ["ci"], smokeResult: "success" }).allowed, true);
});

test("planMerges: one lockfile PR per run, majors and workflow changes need a click", () => {
  const plan = planMerges([
    pr(3), pr(2),
    pr(4, { files: ["package.json"] }),
    pr(5, { bump: "major" }),
    pr(6, { bump: "unknown" }),
    pr(7, { files: [".github/workflows/check.yml"] }),
    pr(8, { checks: { state: "fail", failing: ["ci"], missing: [] } }),
    pr(9, { mergeable: null }),
  ], open);
  assert.deepEqual(plan.merge.map((p) => p.number), [2, 4]);
  assert.deepEqual(plan.waiting.map((p) => p.number).sort(), [3, 9]);
  assert.deepEqual(plan.approvals.map((p) => [p.number, p.kind]), [[5, "deps_major"], [6, "deps_major"], [7, "deps_update"]]);
  assert.deepEqual(plan.failing.map((p) => p.number), [8]);
});

test("planMerges: closed gate turns green patches into approvals; old waiting PRs are stale", () => {
  const plan = planMerges([pr(1), pr(2, { checks: { state: "pending", failing: [], missing: ["ci"] }, createdAt: "2026-01-01T00:00:00Z" })],
    { allowed: false, reason: "kein automatischer Funktionstest" });
  assert.deepEqual(plan.approvals.map((p) => [p.number, p.reason]), [[1, "kein automatischer Funktionstest"]]);
  assert.deepEqual(plan.stale.map((p) => p.number), [2]);
});

test("planMerges: red majors are blocked (no click helps), workflow changes are marked inGitHub", () => {
  const plan = planMerges([
    pr(1, { bump: "major", checks: { state: "fail", failing: ["ci"], missing: [] } }),
    pr(2, { files: [".github/workflows/x.yml"] }),
  ], open);
  assert.deepEqual(plan.blocked.map((p) => p.number), [1]);
  assert.deepEqual(plan.approvals.map((p) => [p.number, p.inGitHub]), [[2, true]]);
});

test("withApproved: approved + green + mergeable moves to merge, respecting lockfile overlap", () => {
  const plan = planMerges([
    pr(1),
    pr(5, { bump: "major" }),
    pr(6, { bump: "major", files: ["apps/x/package.json"] }),
    pr(7, { bump: "major", files: ["b.json"], checks: { state: "pending", failing: [], missing: ["ci"] } }),
    pr(8, { files: [".github/workflows/x.yml"] }),
  ], open);
  const next = withApproved(plan, [5, 6, 7, 8]);
  assert.deepEqual(next.merge.map((p) => [p.number, Boolean(p.approved)]), [[1, false], [6, true]]);
  assert.deepEqual(next.approvals.map((p) => [p.number, p.reason]), [
    [5, "freigegeben, wartet auf grüne Checks"],
    [7, "freigegeben, wartet auf grüne Checks"],
    [8, "freigegeben, wartet auf grüne Checks"],
  ]);
  assert.deepEqual(withApproved(plan, []).merge.map((p) => p.number), [1], "nothing approved → unchanged");
});

test("isSecurityPr: Dependabot security group only", () => {
  assert.equal(isSecurityPr("chore(deps): bump the security group across 1 directory with 3 updates"), true);
  assert.equal(isSecurityPr("chore(deps): bump the minor-and-patch group with 2 updates"), false);
  assert.equal(isSecurityPr("chore(deps): bump security-headers from 1.0.0 to 1.0.1"), false);
});

test("pendingFor: waiting PRs for the sync call, without merge-in-GitHub ones", () => {
  const gateClosed = { allowed: false, reason: "kein automatischer Funktionstest" };
  const plan = planMerges([pr(1, { security: true }), pr(2, { files: [".github/workflows/x.yml"] }), pr(3, { bump: "major", files: ["p.json"] })], gateClosed);
  assert.deepEqual(pendingFor(plan), [
    { number: 1, title: "PR 1", url: "https://github.com/o/r/pull/1", kind: "deps_update", security: true },
    { number: 3, title: "PR 3", url: "https://github.com/o/r/pull/3", kind: "deps_major", security: false },
  ]);
});

test("applySchedule: wave day merges all, otherwise only security, no package nothing", () => {
  const plan = planMerges([pr(1), pr(2, { security: true, files: ["sec.lock"] })], open);
  assert.deepEqual(applySchedule(plan, { updates: "all" }).merge.map((p) => p.number), [1, 2]);
  const off = applySchedule(plan, { updates: "security" });
  assert.deepEqual([off.merge.map((p) => p.number), off.held.map((p) => p.number)], [[2], [1]]);
  const none = applySchedule(plan, { updates: "none" });
  assert.deepEqual([none.merge, none.held.length], [[], 2]);
  assert.deepEqual(applySchedule(plan, undefined).merge, [], "no schedule from the OS = nothing merges");
});

test("buildReport: held for the wave stays ok, majors pending as bundle, no prs in the report", () => {
  const runUrl = "https://github.com/o/r/actions/runs/1";
  const plan = applySchedule(planMerges([pr(1), pr(3, { bump: "major", files: ["p.json"] })], open), { updates: "security" });
  const r = buildReport({ plan, smokeResult: "success", runUrl, scheduleNote: "Patch/Minor am nächsten Montag (Welle 1)" });
  const [, update, major] = r.checks;
  assert.deepEqual([update.status, update.detail], ["ok", "1 warten auf Welle (Patch/Minor am nächsten Montag (Welle 1))"]);
  assert.equal(major.status, "pending_approval");
  assert.match(major.detail, /Sammel-Freigabe pro Monat/);
  assert.ok(r.checks.every((c) => c.prs === undefined));
  const approvedMerge = buildReport({ plan, merged: [{ ...pr(3, { bump: "major" }), kind: "deps_major", approved: true }], smokeResult: "success", runUrl });
  assert.deepEqual(approvedMerge.events, [{ kind: "deps_major", summary: "PR #3 nach Freigabe gemergt (major): PR 3", url: "https://github.com/o/r/pull/3" }]);
});

test("buildReport: statuses per kind, merge events, priorities", () => {
  const runUrl = "https://github.com/o/r/actions/runs/1";
  const plan = planMerges([pr(1), pr(5, { bump: "major" })], open);
  const r = buildReport({ plan, merged: plan.merge, smokeResult: "success", runUrl });
  assert.deepEqual(r.checks.map((c) => [c.kind, c.status]), [["smoke_test", "ok"], ["deps_update", "ok"], ["deps_major", "pending_approval"]]);
  assert.equal(r.checks[1].detail, "1 gemergt");
  assert.equal(r.checks[2].url, "https://github.com/o/r/pull/5");
  assert.deepEqual(r.events, [{ kind: "deps_update", summary: "PR #1 automatisch gemergt (patch): PR 1", url: "https://github.com/o/r/pull/1" }]);

  const failed = buildReport({ plan: planMerges([], open), mergeErrors: [{ ...pr(3), reason: "Merge fehlgeschlagen" }], smokeResult: "none", runUrl });
  assert.deepEqual(failed.checks.map((c) => c.status), ["missing", "fail", "ok"]);
  assert.equal(failed.checks[0].expected_every_hours, 30);
  assert.ok(failed.checks.every((c) => !c.detail || c.detail.length <= 500));
});
