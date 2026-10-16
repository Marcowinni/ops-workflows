// HTTP smoke test against production (ADR 0044): fails the job when a page
// does not answer 2xx or lacks its expected text. The maintenance run reads
// the job result (needs.<job>.result) as smoke-result. Output `result`
// (pass | fail) is set only once the checks actually ran: verify-deploy rolls
// back on "fail" only, never on a broken setup (bad input, action download).
import { appendFileSync } from "node:fs";
import { parseChecks, runChecks } from "./lib/checks.mjs";

function summary(line) {
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function intInput(name, min, max) {
  const value = Number((process.env[`INPUT_${name.toUpperCase()}`] ?? "").trim());
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer ${min}..${max}`);
  return value;
}

async function main() {
  const checks = parseChecks(process.env["INPUT_CHECKS"] ?? "");
  if (checks.length === 0) throw new Error("no checks given (input checks)");
  const failures = await runChecks(checks, {
    attempts: intInput("attempts", 1, 5),
    delayMs: intInput("retry-delay-seconds", 0, 600) * 1000,
  });
  summary(`## Funktionstest (HTTP) — ${checks.length - failures.length}/${checks.length} ok`);
  for (const f of failures) summary(`- ${f}`);
  output("result", failures.length > 0 ? "fail" : "pass");
  if (failures.length > 0) {
    console.error(`::error::${failures.join(" · ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`::error::${e.message}`);
  process.exit(1);
});
