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

const live = { deployResult: "success", smokeJob: "success", smokeResult: "pass", preSmokeResult: "success", rollback: true };
const red = { ...live, smokeJob: "failure", smokeResult: "fail" };

test("decide: green, red (rollback + lock), skipped smoke = untested", () => {
  assert.deepEqual(decide(live), { outcome: "green", deployConfirmed: true, rollback: false, lock: false, blocker: null });
  assert.deepEqual(decide(red), { outcome: "red", deployConfirmed: true, rollback: true, lock: true, blocker: null });
  assert.equal(decide({ ...live, smokeJob: "skipped", smokeResult: "" }).outcome, "untested");
  assert.deepEqual(decide({ ...red, preSmokeResult: "failure" }),
    { outcome: "red", deployConfirmed: true, rollback: false, lock: true, blocker: "Produktion war vor dem Merge nicht nachweislich grün" });
  assert.equal(decide({ ...red, rollback: false }).blocker, "Rollback abgeschaltet");
});

test("decide: a broken setup is never red — no rollback without a test that ran and failed", () => {
  // install / action download failed: job red, no step result
  assert.deepEqual(decide({ ...live, smokeJob: "failure", smokeResult: "" }),
    { outcome: "unconfirmed", deployConfirmed: true, rollback: false, lock: false, blocker: null });
  // HTTP step passed, command step never ran (install failed afterwards)
  assert.equal(decide({ ...live, smokeJob: "failure", smokeResult: "pass" }).outcome, "unconfirmed");
  assert.equal(decide({ ...live, smokeJob: "cancelled", smokeResult: "" }).outcome, "unconfirmed");
  assert.equal(decide({ ...live, deployResult: "timeout", smokeJob: "skipped", smokeResult: "" }).outcome, "unconfirmed");
  assert.equal(decide({ ...live, deployResult: "error", smokeJob: "skipped", smokeResult: "" }).outcome, "unconfirmed");
});

test("decide: failed deploy rolls back without lock, only when the commit before deployed green", () => {
  const failed = { ...live, deployResult: "failure", smokeJob: "skipped", smokeResult: "" };
  assert.deepEqual(decide({ ...failed, baseDeployGreen: true }),
    { outcome: "deploy_failed", deployConfirmed: false, rollback: true, lock: false, blocker: null });
  assert.equal(decide({ ...failed, baseDeployGreen: false }).blocker, "Deploy vor dem Merge war schon nicht grün");
  assert.equal(decide(failed).blocker, "Deploy vor dem Merge unbekannt");
  assert.equal(decide({ ...failed, baseDeployGreen: true, preSmokeResult: "failure" }).rollback, true, "prod health is not the question here");
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

test("rollBack without tag: no lock lines, no tag", async () => {
  const gh = fakeGitHub();
  assert.deepEqual(await rollBack(gh, state, { ...rollbackOpts, reason: "Deploy fehlgeschlagen", tag: null }), { done: true, sha: sha("r"), lockError: null });
  assert.doesNotMatch(gh.calls.commits[0].message, /ops-regression/);
  assert.deepEqual(gh.calls.tags, []);
});

test("rollBack: API error before the fast-forward throws, nothing changed", async () => {
  const gh = { ...fakeGitHub(), createCommit: async () => { throw new Error("POST /git/commits → 502"); } };
  await assert.rejects(rollBack(gh, state, rollbackOpts), /502/);
});

test("rollBack: branch moved during the rollback, tag fails after it", async () => {
  const raced = await rollBack(fakeGitHub({ fastForwardError: "Update is not a fast forward" }), state, rollbackOpts);
  assert.deepEqual(raced, { done: false, reason: "Rollback-Commit nicht übernommen: Update is not a fast forward" });
  const unlocked = await rollBack(fakeGitHub({ tagError: "Reference already exists" }), state, rollbackOpts);
  assert.deepEqual(unlocked, { done: true, sha: sha("r"), lockError: "Reference already exists" });
});

test("buildVerifyReport: green, unconfirmed, untested", () => {
  const green = buildVerifyReport({ state, decision: decide(live), runUrl, repoUrl });
  assert.deepEqual(green.checks.map((c) => [c.kind, c.status, c.detail]), [["smoke_test", "ok", "grün nach Update: #12, #14"]]);
  assert.deepEqual(green.events, [{ kind: "smoke_test", summary: "Funktionstest nach Deploy grün: #12, #14", url: runUrl }]);

  const late = buildVerifyReport({ state, decision: decide({ ...live, deployResult: "timeout", smokeJob: "skipped", smokeResult: "" }), deployDetail: "kein fertiger Produktions-Deploy", runUrl, repoUrl });
  assert.deepEqual([late.checks[0].status, late.checks[0].detail, late.events], ["warn", "Deploy nicht bestätigt (kein fertiger Produktions-Deploy): #12, #14", []]);
  const setup = buildVerifyReport({ state, decision: decide({ ...live, smokeJob: "failure", smokeResult: "" }), runUrl, repoUrl });
  assert.deepEqual([setup.checks[0].status, setup.checks[0].detail], ["warn", "Funktionstest nach Deploy nicht gelaufen (Einrichtung kaputt oder abgebrochen): #12, #14"]);
  const untested = buildVerifyReport({ state, decision: decide({ ...live, smokeJob: "skipped", smokeResult: "" }), runUrl, repoUrl });
  assert.deepEqual(untested, {
    checks: [],
    events: [{ kind: "deps_update", summary: "Deploy live nach Update: #12, #14 (kein Funktionstest nach Deploy)", url: runUrl }],
  });
  assert.ok([...green.checks, ...late.checks, ...setup.checks].every((c) => c.detail.length <= 500 && c.expected_every_hours === 30));
});

test("buildVerifyReport: red with rollback, failed deploy with and without rollback", () => {
  const rolled = buildVerifyReport({
    state,
    decision: decide(red),
    rollback: { done: true, sha: sha("r"), lockError: null },
    rollbackDeploy: { result: "success", detail: "Produktion live: Production" },
    runUrl, repoUrl,
  });
  const [check] = rolled.checks;
  assert.deepEqual([check.kind, check.status, check.url], ["smoke_test", "fail", `${repoUrl}/commit/${sha("r")}`]);
  assert.match(check.detail, /^Funktionstest rot nach Update: #12 chore\(deps\): bump a from 1\.0\.0 to 1\.1\.0, #14 .* · automatisch zurückgerollt \(rrrrrrr\), Rollback live$/);
  assert.equal(rolled.events[0].kind, "smoke_test");

  const failed = { ...live, deployResult: "failure", smokeJob: "skipped", smokeResult: "" };
  const kept = buildVerifyReport({ state, decision: decide({ ...failed, baseDeployGreen: false }), runUrl, repoUrl });
  assert.deepEqual([kept.checks[0].kind, kept.checks[0].status, kept.checks[0].url], ["deps_update", "fail", runUrl]);
  assert.match(kept.checks[0].detail, /^Deploy fehlgeschlagen nach Update \(Produktion lief weiter auf dem alten Stand\): .* · kein Rollback: Deploy vor dem Merge war schon nicht grün — bitte prüfen$/);
  const reverted = buildVerifyReport({
    state, decision: decide({ ...failed, baseDeployGreen: true }), runUrl, repoUrl,
    rollback: { done: true, sha: sha("r"), lockError: null },
    rollbackDeploy: { result: "success", detail: "…" },
  });
  assert.match(reverted.checks[0].detail, /automatisch zurückgerollt \(rrrrrrr\), Rollback live, ohne Regressions-Sperre \(Deploy-Fehler kann vorübergehend sein\)$/);
});

test("buildVerifyReport: rollback problems and API errors are spelled out", () => {
  const decision = decide(red);
  const notDone = buildVerifyReport({ state, decision, rollback: { done: false, reason: "main hat sich seit dem Merge bewegt" }, runUrl, repoUrl });
  assert.match(notDone.checks[0].detail, /kein Rollback: main hat sich seit dem Merge bewegt — bitte prüfen$/);
  const shaky = buildVerifyReport({
    state, decision, runUrl, repoUrl, hookErrors: [500],
    rollback: { done: true, sha: sha("r"), lockError: "exists" },
    rollbackDeploy: { result: "timeout", detail: "…" },
  });
  assert.match(shaky.checks[0].detail, /Rollback-Deploy nicht bestätigt — bitte prüfen, Deploy-Hook fehlgeschlagen \(1\), Regressions-Sperre fehlt \(Tag nicht gesetzt\)$/);
  const before = buildVerifyReport({ state, decision, error: "POST /git/commits → 502", runUrl, repoUrl });
  assert.deepEqual([before.checks[0].status, before.checks[0].url], ["fail", runUrl]);
  assert.match(before.checks[0].detail, /kein Rollback: Fehler \(POST \/git\/commits → 502\) — bitte prüfen$/);
  const after = buildVerifyReport({ state, decision, error: "GET /deployments → 500", rollback: { done: true, sha: sha("r"), lockError: null }, runUrl, repoUrl });
  assert.match(after.checks[0].detail, /automatisch zurückgerollt \(rrrrrrr\), Rollback-Deploy nicht geprüft \(Fehler: GET \/deployments → 500\) — bitte prüfen$/);
  assert.equal(after.checks[0].url, `${repoUrl}/commit/${sha("r")}`);
});
