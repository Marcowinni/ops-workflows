#!/usr/bin/env node
// Creates a new project repo from the template (ADR 0052 Q47, Q53b). Runs on the operator's machine.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { USAGE, parseArgs } from "./lib/args.mjs";
import { executePlan, newReportToken, sha256Hex } from "./lib/execute.mjs";
import { formatFailure, formatPlan, formatSummary } from "./lib/format.mjs";
import { buildPlan } from "./lib/plan.mjs";

function runner(argv, { input } = {}) {
  const result = spawnSync(argv[0], argv.slice(1), { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`${argv.slice(0, 3).join(" ")} endete mit Code ${result.status}: ${(result.stderr ?? "").trim()}`);
    error.stderr = result.stderr ?? "";
    throw error;
  }
  return result.stdout;
}

const fsDeps = {
  mkdtemp: () => mkdtempSync(join(tmpdir(), "ops-deploy-")),
  read: (path) => readFileSync(path, "utf8"),
  remove: (dir) => rmSync(dir, { recursive: true, force: true }),
};

/** gh repo view is read-only: success = exists; «not found» = free; anything else aborts. */
function repoExists(slug) {
  try {
    runner(["gh", "repo", "view", slug]);
    return true;
  } catch (error) {
    if (/could not resolve|not found/i.test(error.stderr ?? "")) return false;
    throw new Error(`Repo-Prüfung fehlgeschlagen: ${error.message}`);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const slug = `${opts.owner}/${opts.name}`;
  if (repoExists(slug)) throw new Error(`Repo ${slug} existiert bereits. Abbruch.`);
  const steps = buildPlan(opts);

  if (opts.dryRun) {
    console.log(`Trockenlauf für ${slug} (es wird nichts ausgeführt):\n`);
    console.log(formatPlan(steps));
    return;
  }

  const token = newReportToken();
  try {
    executePlan({ steps, runner, token, fsDeps });
  } catch (error) {
    console.error(formatFailure(error, steps));
    process.exit(1);
  }
  console.log(formatSummary({ ...opts, tokenHash: sha256Hex(token) }));
}

try {
  main();
} catch (error) {
  console.error(`Fehler: ${error.message}\n${USAGE}`);
  process.exit(1);
}
