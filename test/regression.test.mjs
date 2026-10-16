import assert from "node:assert/strict";
import { test } from "node:test";
import { planMerges } from "../maintain/lib/plan.mjs";
import { parseRegressions, regressionLines, regressionOf, updatesOf } from "../maintain/lib/regression.mjs";

test("updatesOf: single PR title, grouped body, trailing punctuation, no match", () => {
  assert.deepEqual(updatesOf({ title: "chore(deps): bump next from 16.3.6 to 16.3.8 in /erp-dashboard" }), ["next@16.3.8"]);
  assert.deepEqual(updatesOf({
    title: "chore(deps): bump the minor-and-patch group with 2 updates",
    body: "Updates `@supabase/supabase-js` from 2.50.0 to 2.51.1\n- notes\nUpdates `zod` from 4.1.0 to 4.2.0.\n",
  }), ["@supabase/supabase-js@2.51.1", "zod@4.2.0"]);
  assert.deepEqual(updatesOf({ title: "chore(deps): bump something" }), []);
});

test("regressionLines → parseRegressions round trip; title fallback without versions", () => {
  const lines = regressionLines([
    { number: 12, title: "bump a from 1.0.0 to 1.1.0", updates: ["a@1.1.0"] },
    { number: 13, title: "bump the npm group", updates: [] },
  ]);
  assert.deepEqual(lines, ["ops-regression: a@1.1.0", "ops-regression-title: bump the npm group"]);
  const message = `Revert Wartung: #12, #13 (Funktionstest nach Deploy rot)\n\n- #12 …\n\n${lines.join("\n")}`;
  const regressed = parseRegressions([message, "unrelated commit"]);
  assert.deepEqual([...regressed.updates], ["a@1.1.0"]);
  assert.deepEqual([...regressed.titles], ["bump the npm group"]);
});

test("regressionOf: same version blocked, newer version free, title fallback", () => {
  const regressed = { updates: new Set(["a@1.1.0"]), titles: new Set(["bump the npm group"]) };
  assert.equal(regressionOf({ title: "x", updates: ["b@2.0.1", "a@1.1.0"] }, regressed), "zurückgerollt nach Regression: a@1.1.0");
  assert.equal(regressionOf({ title: "x", updates: ["a@1.1.1"] }, regressed), null);
  assert.equal(regressionOf({ title: "bump the npm group", updates: [] }, regressed), "zurückgerollt nach Regression (gleicher Titel)");
});

test("planMerges: a rolled-back update needs a click even when green", () => {
  const green = { state: "pass", failing: [], missing: [] };
  const pr = (number, extra = {}) => ({
    number, title: `PR ${number}`, url: `https://github.com/o/r/pull/${number}`, files: [`f${number}`],
    bump: "patch", checks: green, mergeable: true, createdAt: new Date().toISOString(), ...extra,
  });
  const plan = planMerges([pr(1), pr(2, { regression: "zurückgerollt nach Regression: a@1.1.0" })], { allowed: true, reason: null });
  assert.deepEqual(plan.merge.map((p) => p.number), [1]);
  assert.deepEqual(plan.approvals.map((p) => [p.number, p.kind, p.reason]), [[2, "deps_update", "zurückgerollt nach Regression: a@1.1.0"]]);
});
