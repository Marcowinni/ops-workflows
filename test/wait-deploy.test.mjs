import assert from "node:assert/strict";
import { test } from "node:test";
import { deployStateOnce, evaluateDeployments, isProduction, waitForDeploy } from "../wait-deploy/lib/deployments.mjs";

const SHA = "a".repeat(40);

test("isProduction: Vercel and Railway names, previews out, explicit list wins", () => {
  assert.equal(isProduction("Production"), true);
  assert.equal(isProduction("Production – core"), true);
  assert.equal(isProduction("tw-workers / production"), true);
  assert.equal(isProduction("Preview – core"), false);
  assert.equal(isProduction("github-pages"), false);
  assert.equal(isProduction("Production – core", ["Production – book-core"]), false);
});

test("evaluateDeployments: newest per environment, running, failure, minimum and explicit list", () => {
  const d = (id, environment, state) => ({ id, environment, state });
  assert.equal(evaluateDeployments([]).state, "pending");
  assert.equal(evaluateDeployments([d(1, "Production", "in_progress")]).state, "pending");
  assert.deepEqual(evaluateDeployments([d(1, "Production", "success"), d(2, "Preview", "failure")]),
    { state: "success", environments: ["Production"], failed: [] });
  // blocked git deploy, then the hook deploy succeeds
  assert.equal(evaluateDeployments([d(1, "Production – core", "failure"), d(2, "Production – core", "success")]).state, "success");
  assert.deepEqual(evaluateDeployments([d(1, "Production – core", "success"), d(3, "tw-workers / production", "error")]).failed,
    ["tw-workers / production"]);
  assert.equal(evaluateDeployments([d(1, "Production – core", "success")], { minDeployments: 2 }).state, "pending");
  assert.equal(evaluateDeployments([d(1, "Production – core", "success")], { environments: ["Production – core", "Production – audit"] }).state, "pending");
});

function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => { t += ms; } };
}

/** timeline: [atMs, deployments[]] — what GitHub shows from that moment on. */
function fakeGitHub(clock, timeline) {
  const current = () => [...timeline].reverse().find(([at]) => clock.now() >= at)?.[1] ?? [];
  return {
    deployments: async (sha) => {
      assert.equal(sha, SHA);
      return current().map(({ id, environment }) => ({ id, environment }));
    },
    deploymentState: async (id) => current().find((d) => d.id === id).state,
  };
}

const opts = { settleMs: 60_000, pollMs: 15_000, timeoutMs: 15 * 60_000 };

test("waitForDeploy: success only after the settle window", async () => {
  const clock = fakeClock();
  const gh = fakeGitHub(clock, [
    [0, []],
    [30_000, [{ id: 1, environment: "Production", state: "in_progress" }]],
    [90_000, [{ id: 1, environment: "Production", state: "success" }]],
  ]);
  const r = await waitForDeploy(gh, SHA, opts, clock);
  assert.deepEqual(r, { result: "success", detail: "Produktion live: Production" });
  assert.ok(clock.now() >= 150_000, "waited 60 s after the last change");
});

test("waitForDeploy: a hook deploy after a blocked git deploy turns it green", async () => {
  const clock = fakeClock();
  const gh = fakeGitHub(clock, [
    [0, [{ id: 1, environment: "Production", state: "failure" }]],
    [45_000, [{ id: 1, environment: "Production", state: "failure" }, { id: 2, environment: "Production", state: "success" }]],
  ]);
  assert.equal((await waitForDeploy(gh, SHA, opts, clock)).result, "success");
});

test("deployStateOnce: one look at a commit's production deploys", async () => {
  const clock = fakeClock();
  const gh = fakeGitHub(clock, [[0, [{ id: 1, environment: "Production", state: "success" }, { id: 2, environment: "Preview", state: "error" }]]]);
  assert.equal((await deployStateOnce(gh, SHA)).state, "success");
  assert.equal((await deployStateOnce(gh, SHA, { minDeployments: 2 })).state, "pending");
  assert.equal(clock.now(), 0, "no waiting");
});

test("waitForDeploy: failure and timeout", async () => {
  const failing = fakeClock();
  const failed = await waitForDeploy(fakeGitHub(failing, [[0, [{ id: 1, environment: "Production – core", state: "error" }]]]), SHA, opts, failing);
  assert.deepEqual(failed, { result: "failure", detail: "Deploy fehlgeschlagen: Production – core" });

  const slow = fakeClock();
  const late = await waitForDeploy(fakeGitHub(slow, [[0, [{ id: 1, environment: "Production", state: "queued" }]]]), SHA, opts, slow);
  assert.equal(late.result, "timeout");
  assert.match(late.detail, /aaaaaaa nach 15 min \(gesehen: Production\)/);
});
