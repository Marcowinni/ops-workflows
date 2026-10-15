// TW maintenance run (ADR 0044): evaluate Dependabot PRs, merge what the
// auto-merge limit allows, trigger deploys, report status to the Business OS.
import { appendFileSync } from "node:fs";
import { evaluateChecks } from "./lib/checks.mjs";
import { classifyUpdate } from "./lib/classify.mjs";
import { createGitHub } from "./lib/github.mjs";
import { autoMergeGate, planMerges } from "./lib/plan.mjs";
import { buildReport } from "./lib/report.mjs";

const input = (name) => (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
const list = (value) => value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

const repo = process.env.GITHUB_REPOSITORY;
const runUrl = `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
const reportToken = input("report-token");
const reportUrl = input("report-url");
const requiredChecks = list(input("required-checks"));
const deployHooks = input("deploy-hooks").split(/\s+/).filter(Boolean);
const smokeResult = input("smoke-result") || "none";
const mergeMethod = input("merge-method") || "squash";
const dryRun = input("dry-run") === "true";

function summary(line) {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

async function inspect(gh, pr) {
  const [files, commitMessage, checkRuns, statuses, mergeable] = await Promise.all([
    gh.pullFiles(pr.number),
    gh.commitMessage(pr.head.sha),
    gh.checkRuns(pr.head.sha),
    gh.statuses(pr.head.sha),
    gh.mergeable(pr.number),
  ]);
  return {
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    sha: pr.head.sha,
    createdAt: pr.created_at,
    files,
    mergeable,
    bump: classifyUpdate({ title: pr.title, body: pr.body ?? "", commitMessage }),
    checks: evaluateChecks({ checkRuns, statuses, required: requiredChecks }),
  };
}

async function mergeAll(gh, prs) {
  const merged = [];
  const errors = [];
  for (const pr of prs) {
    try {
      await gh.merge(pr.number, pr.sha, mergeMethod);
      merged.push(pr);
    } catch (e) {
      errors.push({ ...pr, reason: `Merge fehlgeschlagen: ${e.message}`.slice(0, 200) });
    }
  }
  return { merged, errors };
}

async function triggerDeploys() {
  const errors = [];
  for (const hook of deployHooks) {
    const res = await fetch(hook, { method: "POST" }).catch((e) => ({ ok: false, status: e.message }));
    if (!res.ok) errors.push(res.status);
  }
  return errors;
}

async function sendReport(payload) {
  const res = await fetch(reportUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-solution-token": reportToken },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`report → ${res.status}: ${text}`);
  return text;
}

async function main() {
  if (!reportToken) throw new Error("report-token missing (secret OPS_REPORT_TOKEN)");
  const gh = createGitHub({ token: input("github-token"), repo });

  const prs = await Promise.all((await gh.dependabotPulls()).map((pr) => inspect(gh, pr)));
  const gate = autoMergeGate({ requiredChecks, smokeResult });
  const plan = planMerges(prs, gate);

  summary(`## Wartung ${repo}`);
  summary(`Funktionstest: ${smokeResult} · Auto-Merge: ${gate.allowed ? "erlaubt" : `aus (${gate.reason})`}${dryRun ? " · DRY-RUN" : ""}`);
  for (const pr of prs) summary(`- #${pr.number} ${pr.title} — ${pr.bump}, Checks ${pr.checks.state}`);

  const { merged, errors: mergeErrors } = dryRun || plan.merge.length === 0
    ? { merged: [], errors: [] }
    : await mergeAll(gh, plan.merge);
  if (dryRun && plan.merge.length) summary(`Würde mergen: ${plan.merge.map((p) => `#${p.number}`).join(", ")}`);
  const deployErrors = merged.length > 0 ? await triggerDeploys() : [];

  const payload = buildReport({ plan, merged, mergeErrors, deployErrors, smokeResult, runUrl });
  await sendReport(payload);
  for (const c of payload.checks) summary(`- ${c.kind}: ${c.status} — ${c.detail}`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `merged=${merged.map((p) => p.number).join(",")}\n`);
  }
}

main().catch((e) => {
  console.error(`::error::${e.message}`);
  process.exit(1);
});
