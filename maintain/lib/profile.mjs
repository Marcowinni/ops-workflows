// Repo profile for the solution detail page in the Business OS (TWP-17 M1c).
// The daily run reads it from the repo itself, so the page is never edited by
// hand: Steckbrief (AGENTS.md), CI wiring, package scripts, docs present, and
// the check state of the default branch head. Pure functions; I/O in main.mjs.

const CENTRAL_CI = "Marcowinni/ops-workflows/.github/workflows/ci.yml@";
const MAX_VALUE = 200;
const MAX_KEYS = 40;

/**
 * First ```yaml block of AGENTS.md as flat `key: value` pairs; one nesting
 * level becomes `parent.child` (befehle.dev). Comments after `#` are dropped.
 * A minimal reader on purpose: the action has no dependencies.
 */
export function parseSteckbrief(markdown) {
  const block = /```ya?ml\n([\s\S]*?)```/.exec(markdown ?? "");
  if (!block) return null;
  const out = {};
  let parent = null;
  for (const raw of block[1].split("\n")) {
    const line = raw.replace(/\s+#.*$/, "");
    const m = /^(\s*)([a-z_][a-z0-9_]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, indent, key, value] = m;
    if (!indent) parent = value ? null : key;
    if (!value) continue;
    const name = indent && parent ? `${parent}.${key}` : key;
    if (Object.keys(out).length < MAX_KEYS) out[name] = value.trim().slice(0, MAX_VALUE);
  }
  return out;
}

/** ok | fail | pending | none for the default branch head (check runs + statuses). */
export function headState(checkRuns = [], statuses = []) {
  const failing = [
    ...checkRuns.filter((r) => ["failure", "timed_out", "action_required"].includes(r.conclusion)).map((r) => r.name),
    ...statuses.filter((s) => ["failure", "error"].includes(s.state)).map((s) => s.context),
  ];
  if (failing.length) return { state: "fail", failing: [...new Set(failing)].slice(0, 10) };
  const open = checkRuns.some((r) => r.status !== "completed") || statuses.some((s) => s.state === "pending");
  if (open) return { state: "pending", failing: [] };
  return { state: checkRuns.length + statuses.length ? "ok" : "none", failing: [] };
}

function managerOf(files) {
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("package-lock.json")) return "npm";
  if (files.includes("yarn.lock") || files.includes("bun.lockb")) return "other";
  return "none";
}

/**
 * rootFiles: names in the repo root; workflows: {name, text} of
 * .github/workflows/*.yml; pkg: parsed package.json or null.
 */
export function buildProfile({ agentsMd, rootFiles, workflows, pkg, head, headChecks }) {
  return {
    version: 1,
    steckbrief: parseSteckbrief(agentsMd),
    ci: {
      central: workflows.some((w) => w.text.includes(CENTRAL_CI)),
      workflows: workflows.map((w) => w.name).slice(0, 20),
      main_sha: head?.sha ?? null,
      main_state: headChecks.state,
      main_failing: headChecks.failing,
    },
    package: {
      manager: managerOf(rootFiles),
      scripts: Object.keys(pkg?.scripts ?? {}).slice(0, 40),
      node: typeof pkg?.engines?.node === "string" ? pkg.engines.node.slice(0, 40) : null,
      dependencies: Object.keys(pkg?.dependencies ?? {}).length,
      dev_dependencies: Object.keys(pkg?.devDependencies ?? {}).length,
    },
    docs: {
      agents: rootFiles.includes("AGENTS.md"),
      architecture: rootFiles.includes("ARCHITECTURE.md"),
      readme: rootFiles.includes("README.md"),
    },
  };
}
