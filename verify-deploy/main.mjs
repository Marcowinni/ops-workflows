// Check after deploy (ADR 0044): judge the smoke test that ran against the
// freshly deployed merge, roll this run's merges back when it is red or the
// deploy failed (decide.mjs), redeploy, and always report to the Business
// OS. Runs in its own job without repo code — the write token never meets
// freshly updated packages.
import { appendFileSync } from "node:fs";
import { parseHooks, triggerDeployHooks } from "../maintain/lib/deploy-hooks.mjs";
import { createGitHub } from "../maintain/lib/github.mjs";
import { createReporter } from "../maintain/lib/os-report.mjs";
import { deployStateOnce, waitForDeploy } from "../wait-deploy/lib/deployments.mjs";
import { decide } from "./lib/decide.mjs";
import { parseMergeState } from "./lib/merge-state.mjs";
import { buildVerifyReport } from "./lib/report.mjs";
import { rollBack } from "./lib/rollback.mjs";

const input = (name) => (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
const list = (value) => value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

const repo = process.env.GITHUB_REPOSITORY;
const repoUrl = `${process.env.GITHUB_SERVER_URL}/${repo}`;
const runUrl = `${repoUrl}/actions/runs/${process.env.GITHUB_RUN_ID}`;

function summary(line) {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function positiveInt(name) {
  const value = Number(input(name));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

async function main() {
  // Every input is read up front: between a rollback and its report nothing
  // may throw, or the OS would never learn that main was rolled back.
  const reportToken = input("report-token");
  if (!reportToken) throw new Error("report-token missing (secret OPS_REPORT_TOKEN)");
  const state = parseMergeState(input("merge-state"));
  const deployOptions = { environments: list(input("environments")), minDeployments: positiveInt("min-deployments") };
  const timeoutMs = positiveInt("timeout-minutes") * 60_000;
  const deployHooks = parseHooks(input("deploy-hooks"));
  const post = createReporter({ url: input("report-url"), token: reportToken });
  if (!state) {
    summary("Nichts gemergt — kein Test nach Deploy nötig.");
    return;
  }

  const gh = createGitHub({ token: input("github-token"), repo });
  const deployResult = input("deploy-result");
  let baseDeployGreen = null;
  if (deployResult === "failure") {
    try {
      baseDeployGreen = (await deployStateOnce(gh, state.base, deployOptions)).state === "success";
    } catch (e) {
      console.error(`::warning::Deploy-Stand vor dem Merge nicht lesbar: ${e.message}`);
    }
  }
  const decision = decide({
    deployResult,
    smokeJob: input("smoke-job"),
    smokeResult: input("smoke-result"),
    preSmokeResult: input("pre-smoke-result"),
    rollback: input("rollback") !== "false",
    baseDeployGreen,
  });
  summary(`## Test nach Deploy ${repo}: ${decision.outcome}${decision.blocker ? ` (kein Rollback: ${decision.blocker})` : ""}`);

  let rollback = null;
  let rollbackDeploy = null;
  let hookErrors = [];
  let error = null;
  if (decision.rollback) {
    try {
      rollback = await rollBack(gh, state, {
        reason: decision.outcome === "red" ? "Funktionstest nach Deploy rot" : "Deploy fehlgeschlagen",
        runUrl,
        tag: decision.lock ? `ops-regression/${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}` : null,
      });
      summary(rollback.done ? `Zurückgerollt: ${rollback.sha}` : `Kein Rollback: ${rollback.reason}`);
      if (rollback.done) {
        hookErrors = await triggerDeployHooks(deployHooks);
        rollbackDeploy = await waitForDeploy(gh, rollback.sha, { ...deployOptions, timeoutMs });
        summary(`Rollback-Deploy: ${rollbackDeploy.result} — ${rollbackDeploy.detail}`);
      }
    } catch (e) {
      error = e.message.slice(0, 200);
      console.error(`::error::Rollback: ${error}`);
    }
  }

  output("rolled-back", rollback?.done ? rollback.sha : "");
  const payload = buildVerifyReport({
    state, decision, deployDetail: input("deploy-detail"), rollback, rollbackDeploy, hookErrors, error, runUrl, repoUrl,
  });
  await post(payload);
  for (const c of payload.checks) summary(`- ${c.kind}: ${c.status} — ${c.detail}`);
  if (error) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`::error::${e.message}`);
  process.exit(1);
});
