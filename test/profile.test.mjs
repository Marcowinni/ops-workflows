import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProfile, headState, parseSteckbrief } from "../maintain/lib/profile.mjs";

const AGENTS = `# Projekt

\`\`\`yaml
name: Zeiterfassung
typ: kunde            # kunde | eigen
solution_type: web_app # website | web_app
stack: offen
befehle:
  dev: pnpm dev
  test: offen
\`\`\`

\`\`\`yaml
ignored: second block
\`\`\`
`;

test("parseSteckbrief: flat keys, comments dropped, one nesting level", () => {
  assert.deepEqual(parseSteckbrief(AGENTS), {
    name: "Zeiterfassung",
    typ: "kunde",
    solution_type: "web_app",
    stack: "offen",
    "befehle.dev": "pnpm dev",
    "befehle.test": "offen",
  });
});

test("parseSteckbrief: no yaml block or no file → null", () => {
  assert.equal(parseSteckbrief("# nur Text"), null);
  assert.equal(parseSteckbrief(null), null);
});

test("headState: failure wins, then pending, then ok/none", () => {
  const done = (name, conclusion) => ({ name, status: "completed", conclusion });
  assert.deepEqual(headState([done("ci / checks", "failure"), done("b", "success")], [{ context: "Vercel", state: "error" }]), {
    state: "fail",
    failing: ["ci / checks", "Vercel"],
  });
  assert.equal(headState([{ name: "a", status: "in_progress", conclusion: null }]).state, "pending");
  assert.equal(headState([done("a", "success"), done("b", "skipped")]).state, "ok");
  assert.equal(headState([], []).state, "none");
});

test("buildProfile: central CI, package manager, scripts, docs", () => {
  const p = buildProfile({
    agentsMd: AGENTS,
    rootFiles: ["AGENTS.md", "README.md", "package.json", "pnpm-lock.yaml"],
    workflows: [
      { name: "ci.yml", text: "uses: Marcowinni/ops-workflows/.github/workflows/ci.yml@v1" },
      { name: "maintenance.yml", text: "uses: Marcowinni/ops-workflows/maintain@v1" },
    ],
    pkg: { scripts: { build: "x", lint: "y" }, engines: { node: ">=24" }, dependencies: { a: "1" }, devDependencies: {} },
    head: { branch: "main", sha: "abc" },
    headChecks: { state: "ok", failing: [] },
  });
  assert.equal(p.version, 1);
  assert.equal(p.steckbrief.solution_type, "web_app");
  assert.deepEqual(p.ci, { central: true, workflows: ["ci.yml", "maintenance.yml"], main_sha: "abc", main_state: "ok", main_failing: [] });
  assert.deepEqual(p.package, { manager: "pnpm", scripts: ["build", "lint"], node: ">=24", dependencies: 1, dev_dependencies: 0 });
  assert.deepEqual(p.docs, { agents: true, architecture: false, readme: true });
});

test("buildProfile: static site without package.json or own CI", () => {
  const p = buildProfile({ agentsMd: null, rootFiles: ["index.html"], workflows: [], pkg: null, head: null, headChecks: headState() });
  assert.equal(p.steckbrief, null);
  assert.equal(p.ci.central, false);
  assert.equal(p.ci.main_state, "none");
  assert.equal(p.package.manager, "none");
  assert.deepEqual(p.package.scripts, []);
});
