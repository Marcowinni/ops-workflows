// TW maintenance run (ADR 0044): evaluate Dependabot PRs, sync with the
// Business OS (approvals + update wave), merge what the wave, the auto-merge
// limit or a person allows, trigger deploys, report status + proof. Hands
// the merges on (output merge-state) for the check after deploy
// (wait-deploy + verify-deploy).
import { appendFileSync } from "node:fs";
import { evaluateChecks } from "./lib/checks.mjs";
import { classifyUpdate } from "./lib/classify.mjs";
import { parseHooks, triggerDeployHooks } from "./lib/deploy-hooks.mjs";
import { createGitHub } from "./lib/github.mjs";
import { createReporter } from "./lib/os-report.mjs";
import { autoMergeGate, planMerges, withApproved } from "./lib/plan.mjs";
import { parseRegressions, regressionOf, updatesOf } from "./lib/regression.mjs";
import { buildReport } from "./lib/report.mjs";
import { applySchedule, isSecurityPr, pendingFor } from "./lib/schedule.mjs";

const input = (name) => (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
const list = (value) => value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

const repo = process.env.GITHUB_REPOSITORY;
const runUrl = `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
const reportToken = input("report-token");
const requiredChecks = list(input("required-checks"));
const deployHooks = parseHooks(input("deploy-hooks"));
const smokeResult = input("smoke-result") || "none";
const mergeMethod = input("merge-method") || "squash";
const dryRun = input("dry-run") === "true";
const post = createReporter({ url: input("report-url"), token: reportToken });

function summary(line) {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function inspect(gh, pr, regressed) {
  const [files, commitMessage, checkRuns, statuses, mergeable] = await Promise.all([
    gh.pullFiles(pr.number),
    gh.commitMessage(pr.head.sha),
    gh.checkRuns(pr.head.sha),
    gh.statuses(pr.head.sha),
    gh.mergeable(pr.number),
  ]);
  const updates = updatesOf({ title: pr.title, body: pr.body ?? "" });
  return {
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    sha: pr.head.sha,
    createdAt: pr.created_at,
    files,
    mergeable,
    updates,
    regression: regressionOf({ title: pr.title, updates }, regressed),
    bump: classifyUpdate({ title: pr.title, body: pr.body ?? "", commitMessage }),
    security: isSecurityPr(pr.title),
    checks: evaluateChecks({ checkRuns, statuses, required: requiredChecks }),
  };
}

async function mergeAll(gh, prs) {
  const merged = [];
  const errors = [];
  for (const pr of prs) {
    try {
      const res = await gh.merge(pr.number, pr.sha, mergeMethod);
      merged.push({ ...pr, mergeSha: res.sha });
    } catch (e) {
      errors.push({ ...pr, reason: `Merge fehlgeschlagen: ${e.message}`.slice(0, 200) });
    }
  }
  return { merged, errors };
}

/** What verify-deploy needs to judge and, if red, roll back exactly this run's merges. */
function mergeState(before, after, merged) {
  return {
    branch: after.branch,
    base: before.sha,
    head: after.sha,
    merges: merged.map((p) => ({ number: p.number, title: p.title, url: p.url, bump: p.bump, sha: p.mergeSha, updates: p.updates })),
  };
}

async function main() {
  if (!reportToken) throw new Error("report-token missing (secret OPS_REPORT_TOKEN)");
  const gh = createGitHub({ token: input("github-token"), repo });

  const regressed = parseRegressions(await gh.regressionMessages());
  const prs = await Promise.all((await gh.dependabotPulls()).map((pr) => inspect(gh, pr, regressed)));
  const gate = autoMergeGate({ requiredChecks, smokeResult });
  const initial = planMerges(prs, gate);

  summary(`## Wartung ${repo}`);
  summary(`Funktionstest: ${smokeResult} · Auto-Merge: ${gate.allowed ? "erlaubt" : `aus (${gate.reason})`}${dryRun ? " · DRY-RUN" : ""}`);
  for (const pr of prs) {
    summary(`- #${pr.number} ${pr.title} — ${pr.bump}, Checks ${pr.checks.state}${pr.regression ? ` · ${pr.regression}` : ""}`);
  }

  // Sync first (pull model, ADR 0044): the Business OS turns waiting PRs into
  // Inbox approvals, answers with the approved ones and with today's update
  // window of this repo's wave. Only then merge.
  const sync = await post({ pending: pendingFor(initial) });
  const schedule = sync.schedule ?? { updates: "none", note: "kein Takt vom Business OS" };
  const approved = Array.isArray(sync.approved) ? sync.approved : [];
  summary(`Takt: Welle ${schedule.wave ?? "–"} · heute ${schedule.updates} · ${schedule.note}`);
  if (approved.length) summary(`Freigegeben: ${approved.map((n) => `#${n}`).join(", ")}`);
  const plan = withApproved(applySchedule(initial, schedule), approved);

  const willMerge = !dryRun && plan.merge.length > 0;
  const before = willMerge ? await gh.branchHead() : null;
  const { merged, errors: mergeErrors } = willMerge ? await mergeAll(gh, plan.merge) : { merged: [], errors: [] };
  if (dryRun && plan.merge.length) summary(`Würde mergen: ${plan.merge.map((p) => `#${p.number}`).join(", ")}`);
  const deployErrors = merged.length > 0 ? await triggerDeployHooks(deployHooks) : [];
  // Read after the hooks: they deploy whatever the branch head is now.
  const after = merged.length > 0 ? await gh.branchHead() : null;

  const payload = buildReport({ plan, merged, mergeErrors, deployErrors, smokeResult, runUrl, scheduleNote: schedule.note });
  await post(payload);
  for (const c of payload.checks) summary(`- ${c.kind}: ${c.status} — ${c.detail}`);

  output("merged", merged.map((p) => p.number).join(","));
  output("deployed-sha", after?.sha ?? "");
  output("merge-state", after ? JSON.stringify(mergeState(before, after, merged)) : "");
}

main().catch((e) => {
  console.error(`::error::${e.message}`);
  process.exit(1);
});
