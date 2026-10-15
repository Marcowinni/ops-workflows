// HTTP smoke test against production (ADR 0044): fails the job when a page
// does not answer 2xx or lacks its expected text. The maintenance run reads
// the job result (needs.<job>.result) as smoke-result.
import { appendFileSync } from "node:fs";
import { parseChecks, runCheck } from "./lib/checks.mjs";

function summary(line) {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

async function main() {
  const checks = parseChecks(process.env["INPUT_CHECKS"] ?? "");
  if (checks.length === 0) throw new Error("no checks given (input checks)");
  const failures = (await Promise.all(checks.map((c) => runCheck(c)))).filter(Boolean);
  summary(`## Funktionstest (HTTP) — ${checks.length - failures.length}/${checks.length} ok`);
  for (const f of failures) summary(`- ${f}`);
  if (failures.length > 0) {
    console.error(`::error::${failures.join(" · ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`::error::${e.message}`);
  process.exit(1);
});
