// Wait until the production deploy of a commit is final (ADR 0044, check
// after deploy). Hosts report their deploys to GitHub — Vercel as environment
// "Production" or "Production – <project>", Railway as "<project> /
// production" — so the maintenance run needs no hosting token.

const PRODUCTION = /^production\b|\/\s*production$/i;
const RUNNING = new Set(["queued", "pending", "in_progress"]);
const FAILED = new Set(["failure", "error"]);

export const realClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export function isProduction(environment, explicit = []) {
  return explicit.length > 0 ? explicit.includes(environment) : PRODUCTION.test(environment);
}

/**
 * deployments: [{ id, environment, state }] of one commit, state = latest status.
 * Per environment only the newest deployment counts: a git deploy Vercel
 * blocks (bot author) is followed by the deploy-hook one.
 * Returns { state: pending | success | failure, environments, failed }.
 */
export function evaluateDeployments(deployments, { environments = [], minDeployments = 1 } = {}) {
  const newest = new Map();
  for (const d of deployments) {
    if (!isProduction(d.environment, environments)) continue;
    const prev = newest.get(d.environment);
    if (!prev || d.id > prev.id) newest.set(d.environment, d);
  }
  const found = [...newest.values()];
  const names = [...newest.keys()];
  const incomplete = found.length < Math.max(minDeployments, 1) || environments.some((e) => !newest.has(e));
  if (incomplete || found.some((d) => RUNNING.has(d.state))) return { state: "pending", environments: names, failed: [] };
  const failed = found.filter((d) => FAILED.has(d.state)).map((d) => d.environment);
  return { state: failed.length > 0 ? "failure" : "success", environments: names, failed };
}

function describe(evaluation) {
  return evaluation.state === "success"
    ? `Produktion live: ${evaluation.environments.join(", ")}`
    : `Deploy fehlgeschlagen: ${evaluation.failed.join(", ")}`;
}

/** Production deployments of `sha` with their latest state: [{ id, environment, state }]. */
async function productionDeployments(gh, sha, environments) {
  const production = (await gh.deployments(sha)).filter((d) => isProduction(d.environment, environments));
  return Promise.all(production.map(async (d) => ({
    id: d.id,
    environment: d.environment,
    state: await gh.deploymentState(d.id),
  })));
}

/** One look, no waiting: e.g. whether the commit before the merge was deployed green. */
export async function deployStateOnce(gh, sha, { environments = [], minDeployments = 1 } = {}) {
  return evaluateDeployments(await productionDeployments(gh, sha, environments), { environments, minDeployments });
}

/**
 * Poll until the production deploys of `sha` are final and nothing changed
 * for `settleMs` (a hook deploy can follow a blocked git deploy; aliasing
 * takes a moment), or time out. Returns { result: success | failure | timeout, detail }.
 */
export async function waitForDeploy(gh, sha, options = {}, clock = realClock) {
  const { environments = [], minDeployments = 1, timeoutMs = 15 * 60_000, settleMs = 60_000, pollMs = 15_000 } = options;
  const start = clock.now();
  let fingerprint = "";
  let changedAt = start;
  let seen = [];
  while (clock.now() - start < timeoutMs) {
    const deployments = await productionDeployments(gh, sha, environments);
    const next = deployments.map((d) => `${d.id}:${d.state}`).sort().join(",");
    if (next !== fingerprint) {
      fingerprint = next;
      changedAt = clock.now();
    }
    const evaluation = evaluateDeployments(deployments, { environments, minDeployments });
    seen = evaluation.environments;
    if (evaluation.state !== "pending" && clock.now() - changedAt >= settleMs) {
      return { result: evaluation.state, detail: describe(evaluation) };
    }
    await clock.sleep(pollMs);
  }
  const minutes = Math.round(timeoutMs / 60_000);
  const saw = seen.length > 0 ? ` (gesehen: ${seen.join(", ")})` : "";
  return { result: "timeout", detail: `kein fertiger Produktions-Deploy für ${sha.slice(0, 7)} nach ${minutes} min${saw}` };
}
