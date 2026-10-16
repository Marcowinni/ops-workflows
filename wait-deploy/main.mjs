// Wait for the production deploy of the maintenance merge (ADR 0044). Fails
// the step unless the deploy is live, so the smoke steps after it only run
// against the new version. Output `result` tells verify-deploy why.
import { appendFileSync } from "node:fs";
import { createGitHub } from "../maintain/lib/github.mjs";
import { waitForDeploy } from "./lib/deployments.mjs";

const input = (name) => (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
const list = (value) => value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

function positiveInt(name) {
  const value = Number(input(name));
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function summary(line) {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
  const sha = input("sha");
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("sha must be a full commit sha (maintain output deployed-sha)");
  const gh = createGitHub({ token: input("github-token"), repo: process.env.GITHUB_REPOSITORY });
  const { result, detail } = await waitForDeploy(gh, sha, {
    environments: list(input("environments")),
    minDeployments: positiveInt("min-deployments"),
    timeoutMs: positiveInt("timeout-minutes") * 60_000,
    settleMs: positiveInt("settle-seconds") * 1000,
  });
  summary(`## Deploy ${sha.slice(0, 7)}: ${result} — ${detail}`);
  output("result", result);
  output("detail", detail);
  if (result !== "success") {
    console.error(`::error::${detail}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`::error::${e.message}`);
  output("result", "error");
  process.exit(1);
});
