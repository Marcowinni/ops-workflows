import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRegressions } from "../maintain/lib/regression.mjs";
import { decide } from "../verify-deploy/lib/decide.mjs";
import { parseMergeState } from "../verify-deploy/lib/merge-state.mjs";
import { buildVerifyReport } from "../verify-deploy/lib/report.mjs";
import { rollBack } from "../verify-deploy/lib/rollback.mjs";

const sha = (c) => c.repeat(40);
const BASE = sha("b");
const M1 = sha("1");
const M2 = sha("2");
const state = {
  branch: "main",
  base: BASE,
  head: M2,
  merges: [
    { number: 12, title: "chore(deps): bump a from 1.0.0 to 1.1.0", url: "https://github.com/o/r/pull/12", bump: "minor", sha: M1, updates: ["a@1.1.0"] },
    { number: 14, title: "chore(deps): bump the npm group with 2 updates", url: "https://github.com/o/r/pull/14", bump: "patch", sha: M2, updates: [] },
  ],
};
const runUrl = "https://github.com/o/r/actions/runs/7";
const repoUrl = "https://github.com/o/r";

test("decide: outcomes and rollback guards", () => {
  const base = { deployResult: "success", smokeResult: "success", preSmokeResult: "success", rollback: true };
  assert.deepEqual(decide(base), { outcome: "green", deployConfirmed: true, rollback: false, blocker: null });
  assert.deepEqual(decide({ ...base, smokeResult: "failure" }), { outcome: "red", deployConfirmed: true, rollback: true, blocker: null });
  assert.deepEqual(decide({ ...base, deployResult: "failure", smokeResult: "skipped" }),
    { outcome: "deploy_failed", deployConfirmed: false, rollback: true, blocker: null });
  assert.equal(decide({ ...base, deployResult: "timeout", smokeResult: "skipped" }).outcome, "unconfirmed");
  assert.equal(decide({ ...base, deployResult: "", smokeResult: "skipped" }).outcome, "unconfirmed");
  assert.deepEqual([decide({ ...base, smokeResult: "cancelled" }).outcome, decide({ ...base, smokeResult: "cancelled" }).rollback], ["unconfirmed", false]);
  assert.equal(decide({ ...base, smokeResult: "skipped" }).outcome, "untested");
  assert.deepEqual(decide({ ...base, smokeResult: "failure", preSmokeResult: "failure" }),
    { outcome: "red", deployConfirmed: true, rollback: false, blocker: "Produktion war vor dem Merge nicht nachweislich grün" });
  assert.equal(decide({ ...base, smokeResult: "failure", rollback: false }).blocker, "Rollback abgeschaltet");
});

test("parseMergeState: empty = nothing merged, strict shape", () => {
  assert.equal(parseMergeState(""), null);
  assert.deepEqual(parseMergeState(JSON.stringify(state)), state);
  assert.throws(() => parseMergeState(JSON.stringify({ ...state, head: "HEAD" })), /commit shas/);
  assert.throws(() => parseMergeState(JSON.stringify({ ...state, branch: "main; rm -rf" })), /branch/);
  assert.throws(() => parseMergeState(JSON.stringify({ ...state, merges: [] })), /merges missing/);
  assert.throws(() => parseMergeState("{"), SyntaxError);
});

/** Fake GitHub: a linear branch base → M1 → M2 unless told otherwise. */
function fakeGitHub({ head = M2, parents = { [M1]: [BASE], [M2]: [M1] }, fastForwardError, tagError } = {}) {
  const calls = { commits: [], fastForward: [], tags: [] };
  return {
    calls,
    branchHead: async () => ({ branch: "main", sha: head }),
    gitCommit: async (s) => ({ tree: `tree-of-${s.slice(0, 1)}`, parents: parents[s] ?? [] }),
    createCommit: async (c) => {
      calls.commits.push(c);
      return sha("r");
    },
    fastForward: async (branch, s) => {
      if (fastForwardError) throw new Error(fastForwardError);
      calls.fastForward.push([branch, s]);
    },
    createTag: async (name, s) => {
      if (tagError) throw new Error(tagError);
      calls.tags.push([name, s]);
    },
  };
}

const rollbackOpts = { reason: "Funktionstest nach Deploy rot", runUrl, tag: "ops-regression/7-1" };

test("rollBack: base tree on top of head, fast-forward, tag, regression lines", async () => {
  const gh = fakeGitHub();
  const r = await rollBack(gh, state, rollbackOpts);
  assert.deepEqual(r, { done: true, sha: sha("r"), lockError: null });
  const [commit] = gh.calls.commits;
  assert.equal(commit.tree, "tree-of-b");
  assert.deepEqual(commit.parents, [M2]);
  assert.match(commit.message, /^Revert Wartung: #12, #14 \(Funktionstest nach Deploy rot\)\n/);
  assert.match(commit.message, /Lauf: https:\/\/github\.com\/o\/r\/actions\/runs\/7/);
  const locked = parseRegressions([commit.message]);
  assert.deepEqual([[...locked.updates], [...locked.titles]], [["a@1.1.0"], ["chore(deps): bump the npm group with 2 updates"]]);
  assert.deepEqual(gh.calls.fastForward, [["main", sha("r")]]);
  assert.deepEqual(gh.calls.tags, [["ops-regression/7-1", sha("r")]]);
});

test("rollBack: never touches foreign commits", async () => {
  const moved = fakeGitHub({ head: sha("9") });
  assert.deepEqual(await rollBack(moved, state, rollbackOpts), { done: false, reason: "main hat sich seit dem Merge bewegt" });
  assert.equal(moved.calls.commits.length, 0);

  const between = fakeGitHub({ parents: { [M2]: [sha("f")], [sha("f")]: [M1], [M1]: [BASE] } });
  assert.deepEqual(await rollBack(between, state, rollbackOpts), { done: false, reason: "fremde Commits zwischen den Merges" });

  const belowBase = fakeGitHub({ parents: { [M2]: [M1], [M1]: [sha("f")] } });
  assert.equal((await rollBack(belowBase, state, rollbackOpts)).done, false);
  assert.equal(belowBase.calls.commits.length, 0);
});

test("rollBack: branch moved during the rollback, tag fails after it", async () => {
  const raced = await rollBack(fakeGitHub({ fastForwardError: "Update is not a fast forward" }), state, rollbackOpts);
  assert.deepEqual(raced, { done: false, reason: "Rollback-Commit nicht übernommen: Update is not a fast forward" });
  const unlocked = await rollBack(fakeGitHub({ tagError: "Reference already exists" }), state, rollbackOpts);
  assert.deepEqual(unlocked, { done: true, sha: sha("r"), lockError: "Reference already exists" });
});

test("buildVerifyReport: green, unconfirmed, red with rollback, failed deploy without rollback", () => {
  const green = buildVerifyReport({ state, decision: decide({ deployResult: "success", smokeResult: "success", preSmokeResult: "success", rollback: true }), runUrl, repoUrl });
  assert.deepEqual(green.checks.map((c) => [c.kind, c.status, c.detail]), [["smoke_test", "ok", "grün nach Update: #12, #14"]]);
  assert.deepEqual(green.events, [{ kind: "smoke_test", summary: "Funktionstest nach Deploy grün: #12, #14", url: runUrl }]);

  const late = buildVerifyReport({ state, decision: decide({ deployResult: "timeout", smokeResult: "skipped" }), deployDetail: "kein fertiger Produktions-Deploy", runUrl, repoUrl });
  assert.deepEqual([late.checks[0].status, late.checks[0].detail, late.events], ["warn", "Deploy nicht bestätigt (kein fertiger Produktions-Deploy): #12, #14", []]);
  const cancelled = buildVerifyReport({ state, decision: decide({ deployResult: "success", smokeResult: "cancelled" }), runUrl, repoUrl });
  assert.equal(cancelled.checks[0].detail, "Funktionstest nach Deploy abgebrochen: #12, #14");
  const untested = buildVerifyReport({ state, decision: decide({ deployResult: "success", smokeResult: "skipped" }), runUrl, repoUrl });
  assert.deepEqual(untested, {
    checks: [],
    events: [{ kind: "deps_update", summary: "Deploy live nach Update: #12, #14 (kein Funktionstest nach Deploy)", url: runUrl }],
  });

  const red = buildVerifyReport({
    state,
    decision: decide({ deployResult: "success", smokeResult: "failure", preSmokeResult: "success", rollback: true }),
    rollback: { done: true, sha: sha("r"), lockError: null },
    rollbackDeploy: { result: "success", detail: "Produktion live: Production" },
    runUrl, repoUrl,
  });
  const [check] = red.checks;
  assert.deepEqual([check.kind, check.status, check.url], ["smoke_test", "fail", `${repoUrl}/commit/${sha("r")}`]);
  assert.match(check.detail, /^Funktionstest rot nach Update: #12 chore\(deps\): bump a from 1\.0\.0 to 1\.1\.0, #14 .* · automatisch zurückgerollt \(rrrrrrr\), Rollback live$/);
  assert.equal(red.events[0].kind, "smoke_test");

  const broken = buildVerifyReport({
    state,
    decision: decide({ deployResult: "failure", smokeResult: "failure", preSmokeResult: "none", rollback: true }),
    runUrl, repoUrl,
  });
  assert.deepEqual([broken.checks[0].kind, broken.checks[0].status, broken.checks[0].url], ["deps_update", "fail", runUrl]);
  assert.match(broken.checks[0].detail, /kein Rollback: Produktion war vor dem Merge nicht nachweislich grün — bitte prüfen$/);
  assert.ok([...green.checks, ...red.checks, ...broken.checks].every((c) => c.detail.length <= 500 && c.expected_every_hours === 30));
});

test("buildVerifyReport: rollback problems are spelled out", () => {
  const decision = decide({ deployResult: "success", smokeResult: "failure", preSmokeResult: "success", rollback: true });
  const notDone = buildVerifyReport({ state, decision, rollback: { done: false, reason: "main hat sich seit dem Merge bewegt" }, runUrl, repoUrl });
  assert.match(notDone.checks[0].detail, /kein Rollback: main hat sich seit dem Merge bewegt — bitte prüfen$/);
  const shaky = buildVerifyReport({
    state, decision, runUrl, repoUrl, hookErrors: [500],
    rollback: { done: true, sha: sha("r"), lockError: "exists" },
    rollbackDeploy: { result: "timeout", detail: "…" },
  });
  assert.match(shaky.checks[0].detail, /Rollback-Deploy nicht bestätigt — bitte prüfen, Deploy-Hook fehlgeschlagen \(1\), Regressions-Sperre fehlt \(Tag nicht gesetzt\)$/);
});
