// Check `standard` (ADR 0052 Q59): text/file rules of the coding standard.
// mode=warn (default): warnings + summary, always exit 0.
// mode=enforce: findings of severity error fail the step.
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createGitClient } from "./lib/git-diff.mjs";
import { annotation, shouldFail, summaryMarkdown } from "./lib/report.mjs";
import { runStandard } from "./lib/run.mjs";

const input = (name) => (process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim();
const root = process.env.GITHUB_WORKSPACE || process.cwd();

const centralSecurity = readFileSync(new URL("./security-standard.md", import.meta.url), "utf8");

const ctx = {
  read: (path) => (existsSync(join(root, path)) && statSync(join(root, path)).isFile() ? readFileSync(join(root, path), "utf8") : null),
  isDir: (path) => existsSync(join(root, path)) && statSync(join(root, path)).isDirectory(),
};

function pullRequestFromEvent() {
  if (process.env.GITHUB_EVENT_NAME !== "pull_request" || !process.env.GITHUB_EVENT_PATH) return null;
  const { pull_request: p } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  return { number: p.number, body: p.body ?? "", author: p.user?.login ?? "", baseSha: p.base.sha };
}

async function main() {
  const mode = input("mode") || "warn";
  if (!["warn", "enforce"].includes(mode)) throw new Error(`mode must be warn or enforce, got «${mode}»`);
  const pr = pullRequestFromEvent();
  const api = createGitClient({ cwd: root });
  const { findings, stufe, source } = await runStandard({ ctx, levelInput: input("level"), pr, api, centralSecurity });

  for (const f of findings) console.log(annotation(f));
  const summary = summaryMarkdown({ findings, stufe, source, mode, event: pr ? "Pull Request" : "Push" });
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (shouldFail(findings, mode)) {
    console.error(`::error::standard: ${findings.filter((f) => f.severity === "error").length} Befunde (Modus enforce)`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`::error::${e.message}`);
  process.exit(1);
});
