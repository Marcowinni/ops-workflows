import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs, validateName } from "../setup/lib/args.mjs";
import { executePlan, sha256Hex } from "../setup/lib/execute.mjs";
import { formatFailure, formatPlan, formatSummary } from "../setup/lib/format.mjs";
import { buildPlan } from "../setup/lib/plan.mjs";
import { mainProtectionRuleset } from "../setup/lib/rulesets.mjs";

const opts = { owner: "Marcowinni", name: "demo", template: "Marcowinni/project-template" };
const TARGET = { target: "branch", enforcement: "active", conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } } };

test("args: defaults and flags", () => {
  assert.deepEqual(parseArgs(["demo"]), { owner: "Marcowinni", template: "Marcowinni/project-template", protect: false, dryRun: false, name: "demo" });
  const o = parseArgs(["demo", "--owner", "x", "--template", "x/t", "--protect", "--dry-run"]);
  assert.deepEqual([o.owner, o.template, o.protect, o.dryRun], ["x", "x/t", true, true]);
  assert.equal(parseArgs(["--protect", "demo"]).name, "demo");
});

test("args: rejects unknown flags, missing values, extra args, missing name", () => {
  for (const bad of [["demo", "--nope"], ["demo", "--owner"], ["demo", "--owner", "--protect"], ["a1", "b2"], []]) assert.throws(() => parseArgs(bad));
});

test("name validation", () => {
  for (const ok of ["ab", "a-b", "0abc", "x".repeat(63)]) assert.ok(validateName(ok), ok);
  for (const bad of ["a", "-ab", "Ab", "a_b", "a b", "a/b", "x".repeat(64), "", "ä"]) assert.ok(!validateName(bad), bad);
  assert.throws(() => parseArgs(["Bad_Name"]), /Ungültiger Name/);
});

test("ruleset A: main-schutz exact", () => {
  assert.deepEqual(mainProtectionRuleset(), {
    name: "main-schutz",
    ...TARGET,
    bypass_actors: [{ actor_type: "DeployKey", bypass_mode: "always" }],
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: { required_approving_review_count: 0, dismiss_stale_reviews_on_push: false, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false },
      },
      {
        type: "required_status_checks",
        parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: "ci / checks" }, { context: "ci / secret-scan" }, { context: "ci / standard" }] },
      },
    ],
  });
});

test("plan: without --protect only repo and token; with --protect adds key and ruleset", () => {
  assert.deepEqual(buildPlan({ ...opts, protect: false }).map((s) => s.id), ["repo", "report-token"]);
  const steps = buildPlan({ ...opts, protect: true });
  assert.deepEqual(steps.map((s) => s.id), ["repo", "report-token", "deploy-key", "rulesets"]);
  assert.deepEqual(steps[0].commands[0].argv, ["gh", "repo", "create", "Marcowinni/demo", "--template", "Marcowinni/project-template", "--private", "--clone"]);
  const rulesets = steps[3].commands.map((c) => JSON.parse(c.stdin).name);
  assert.deepEqual(rulesets, ["main-schutz"]);
});

test("dry-run plan output contains placeholders and no secret", () => {
  const text = formatPlan(buildPlan({ ...opts, protect: true }));
  assert.match(text, /< stdin: <token>/);
  assert.match(text, /<private-key>/);
  assert.match(text, /gh repo create Marcowinni\/demo/);
  assert.doesNotMatch(text, /[0-9a-f]{64}/);
});

function fakeDeps({ failOn } = {}) {
  const calls = [];
  const removed = [];
  const runner = (argv, { input } = {}) => {
    calls.push({ argv, input });
    if (failOn && argv.join(" ").includes(failOn)) throw new Error("boom");
    return "";
  };
  const fsDeps = {
    mkdtemp: () => "/tmp/x",
    read: (p) => (p.endsWith(".pub") ? "ssh-ed25519 PUB comment\n" : "PRIVATE-KEY-TEXT"),
    remove: (d) => removed.push(d),
  };
  return { calls, removed, runner, fsDeps };
}

test("execute: token and keys go via stdin only, never argv", () => {
  const d = fakeDeps();
  const done = executePlan({ steps: buildPlan({ ...opts, protect: true }), runner: d.runner, token: "TOKEN123", fsDeps: d.fsDeps });
  assert.deepEqual(done, ["repo", "report-token", "deploy-key", "rulesets"]);
  const tokenCall = d.calls.find((c) => c.argv.includes("OPS_REPORT_TOKEN"));
  assert.equal(tokenCall.input, "TOKEN123");
  assert.ok(!d.calls.some((c) => c.argv.some((a) => a.includes("TOKEN123") || a.includes("PRIVATE-KEY"))));
  assert.equal(d.calls.find((c) => c.argv.includes("OPS_DEPLOY_KEY")).input, "PRIVATE-KEY-TEXT");
  assert.ok(d.calls.some((c) => c.argv.includes("key=ssh-ed25519 PUB comment")));
  assert.deepEqual(d.removed, ["/tmp/x"]);
  assert.equal(sha256Hex("a").length, 64);
});

test("execute: failure stops, lists done steps, cleans tmpdir, no retry, no secret in message", () => {
  const d = fakeDeps({ failOn: "OPS_DEPLOY_KEY" });
  const steps = buildPlan({ ...opts, protect: true });
  let error;
  try {
    executePlan({ steps, runner: d.runner, token: "T", fsDeps: d.fsDeps });
  } catch (e) {
    error = e;
  }
  assert.deepEqual(error.done, ["repo", "report-token"]);
  assert.deepEqual(d.removed, ["/tmp/x"]);
  assert.equal(d.calls.filter((c) => c.argv.includes("OPS_DEPLOY_KEY")).length, 1);
  assert.ok(!d.calls.some((c) => c.argv.includes("rulesets") || c.argv.some((a) => String(a).endsWith("/rulesets"))));
  const report = formatFailure(error, steps);
  assert.match(report, /Bereits ausgeführt: repo, report-token/);
  assert.match(report, /gh repo delete Marcowinni\/demo/);
});

test("summary names repo, hash, protect state and next steps", () => {
  const s = formatSummary({ ...opts, tokenHash: "ab".repeat(32), protect: false });
  for (const part of ["https://github.com/Marcowinni/demo", "ab".repeat(32), "nein", "create_solution", "update_solution", "status: paused", "Steckbrief", "Neues Projekt"]) assert.ok(s.includes(part), part);
});
