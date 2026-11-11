import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveLevel } from "../standard/lib/level.mjs";
import { checkPr } from "../standard/lib/pr-rules.mjs";
import { annotation, shouldFail, summaryMarkdown } from "../standard/lib/report.mjs";
import { checkAgents, checkDesign, checkFiles, parseSteckbrief } from "../standard/lib/repo-rules.mjs";
import { runStandard } from "../standard/lib/run.mjs";

const FIELDS = ["name: x", "typ: loesung", "business_ref: TWP-1", "daten: keine", "solution_type: web_app", "paket: a", "stack: node", "befehle:", "  dev: npm run dev", "zweck: z", "kunde: k", "ausnahmen: keine"];
const agents = (lines = FIELDS) => `# X\n\n\`\`\`yaml\n${lines.join("\n")}\n\`\`\`\n`;
const PLAN = "# Plan\n## Ziel\nEine Seite bauen.\n";
const ARCH = "# Arch\nzeile eins\nzeile zwei\nzeile drei\n";
const ids = (fs) => fs.map((f) => f.id);

function makeCtx(files, dirs = []) {
  return { read: (p) => files[p] ?? null, isDir: (p) => dirs.includes(p) };
}
const fullFiles = { "AGENTS.md": agents(), "CLAUDE.md": "@AGENTS.md\n", "docs/PLAN.md": PLAN, "docs/ARCHITECTURE.md": ARCH, "docs/SECURITY.md": "s" };

test("level: solution_type mapping per Q42", () => {
  const stufe = (solution_type) => resolveLevel({ steckbrief: { solution_type } }).stufe;
  assert.equal(stufe("website"), 1);
  assert.equal(stufe("web_app"), 2);
  for (const t of ["integrated_app", "ai_workspace", "ai_process", "platform"]) assert.equal(stufe(t), 3);
});

test("level: unknown, missing and offen -> Stufe 1 plus finding; input overrides", () => {
  for (const sb of [{ solution_type: "offen" }, { solution_type: "banane" }, {}, null]) {
    const r = resolveLevel({ steckbrief: sb });
    assert.equal(r.stufe, 1);
    assert.deepEqual(ids(r.findings), ["stufe-unbekannt"]);
  }
  assert.equal(resolveLevel({ levelInput: "integrated_app", steckbrief: { solution_type: "website" } }).stufe, 3);
  assert.equal(resolveLevel({ levelInput: "2" }).stufe, 2);
  assert.deepEqual(ids(resolveLevel({ levelInput: "x", steckbrief: { solution_type: "web_app" } }).findings), ["stufe-unbekannt"]);
});

test("files: complete repo is clean, Stufe 1 needs only three files", () => {
  assert.deepEqual(checkFiles({ stufe: 2, ctx: makeCtx(fullFiles, ["docs/decisions"]) }), []);
  assert.deepEqual(checkFiles({ stufe: 1, ctx: makeCtx({ "AGENTS.md": "a", "CLAUDE.md": "@AGENTS.md", "docs/PLAN.md": "p" }) }), []);
});

test("files: missing files, decisions dir and CLAUDE.md content", () => {
  const f = checkFiles({ stufe: 2, ctx: makeCtx({ "CLAUDE.md": "# eigener Text" }) });
  const messages = f.map((x) => x.message).join("|");
  for (const m of ["AGENTS.md", "docs/PLAN.md", "docs/ARCHITECTURE.md", "docs/SECURITY.md", "docs/decisions/"]) assert.ok(messages.includes(m), m);
  assert.ok(ids(f).includes("claude-md-inhalt"));
  assert.deepEqual(ids(checkFiles({ stufe: 1, ctx: makeCtx({ "AGENTS.md": "a", "CLAUDE.md": "\n @AGENTS.md \n\n", "docs/PLAN.md": "p" }) })), []);
});

test("agents: length cap, Steckbrief fields (befehle.dev counts), obsolete fields", () => {
  const sb = (md) => parseSteckbrief(md);
  assert.deepEqual(checkAgents({ agentsMd: agents(), steckbrief: sb(agents()) }), []);
  const long = `${agents()}${"zeile\n".repeat(150)}`;
  assert.deepEqual(ids(checkAgents({ agentsMd: long, steckbrief: sb(long) })), ["agents-zu-lang"]);
  const lacking = agents(FIELDS.filter((l) => !l.startsWith("zweck") && !l.startsWith("befehle") && !l.startsWith("  dev")));
  const f = checkAgents({ agentsMd: lacking, steckbrief: sb(lacking) });
  assert.match(f[0].message, /befehle, zweck/);
  const obsolete = agents([...FIELDS, "qualitaet: hoch", "status_datei: x", "personal_ref: y"]);
  assert.match(checkAgents({ agentsMd: obsolete, steckbrief: sb(obsolete) })[0].message, /qualitaet, status_datei, personal_ref/);
  assert.deepEqual(ids(checkAgents({ agentsMd: "# nix", steckbrief: null })), ["steckbrief-fehlt"]);
});

test("design: approved is clean; each gap yields a finding; PR with code is 'kein Code vor Entwurf'", () => {
  const sb = parseSteckbrief(agents());
  const ok = checkDesign({ stufe: 2, steckbrief: sb, ctx: makeCtx(fullFiles) });
  assert.deepEqual(ok, []);
  const offen = parseSteckbrief(agents(FIELDS.map((l) => (l.startsWith("zweck") ? "zweck: Offen" : l))));
  assert.deepEqual(ids(checkDesign({ stufe: 1, steckbrief: offen, ctx: makeCtx(fullFiles) })), ["design-nicht-freigegeben"]);
  const noGoal = makeCtx({ ...fullFiles, "docs/PLAN.md": "# Plan\n## Ziel\n\n## Schritte\nviel" });
  assert.equal(checkDesign({ stufe: 1, steckbrief: sb, ctx: noGoal }).length, 1);
  const thinArch = makeCtx({ ...fullFiles, "docs/ARCHITECTURE.md": "# A\nnur eine" });
  assert.equal(checkDesign({ stufe: 2, steckbrief: sb, ctx: thinArch }).length, 1);
  assert.equal(checkDesign({ stufe: 1, steckbrief: sb, ctx: thinArch }).length, 0);
  assert.deepEqual(ids(checkDesign({ stufe: 1, steckbrief: offen, ctx: makeCtx(fullFiles), codeChanged: true })), ["kein-code-vor-entwurf"]);
});

const BODY = "## Arbeitspaket\nAP-1\n**Was und warum:** x\nBeweis: Tests\n- Nicht geprüft: y\n";
const file = (filename, status = "modified") => ({ filename, status });
const pr = (over = {}) => ({ body: BODY, author: "marco", ...over });
const run = (args) => checkPr({ stufe: 2, baseHasDir: async () => true, ...args });

test("pr: clean code PR with plan and all fields", async () => {
  assert.deepEqual(await run({ pr: pr(), files: [file("src/a.ts"), file("docs/PLAN.md")] }), []);
});

test("pr: code without PLAN.md -> finding; 'plan: unverändert' / unveraendert opts out", async () => {
  const files = [file("src/a.ts")];
  assert.deepEqual(ids(await run({ pr: pr(), files })), ["plan-nicht-angepasst"]);
  for (const line of ["plan: unverändert", "Plan: Unveraendert"]) {
    assert.deepEqual(await run({ pr: pr({ body: `${BODY}${line}\n` }), files }), []);
  }
});

test("pr: missing PR body fields listed", async () => {
  const f = await run({ pr: pr({ body: "## Beweis\nok" }), files: [file("src/a.ts"), file("docs/PLAN.md")] });
  assert.deepEqual(ids(f), ["pr-felder"]);
  assert.match(f[0].message, /Arbeitspaket, Was und warum, Nicht geprüft/);
});

test("pr: docs-only and dotfile-only PRs skip rules 6-7", async () => {
  assert.deepEqual(await run({ pr: pr({ body: "" }), files: [file("docs/ARCHITECTURE.md"), file("README.md"), file(".github/workflows/x.yml")] }), []);
});

test("pr: dependabot skips everything", async () => {
  assert.deepEqual(await run({ pr: pr({ author: "dependabot[bot]", body: "" }), files: [file("package.json"), file("supabase/migrations/1.sql", "added")] }), []);
});

test("pr: Stufe >=2 structural change needs ARCHITECTURE.md; Stufe 1 does not", async () => {
  for (const f of ["supabase/migrations/001.sql", "docker-compose.prod.yml", "vercel.json", "Dockerfile", "supabase/config.toml", "railway.toml"]) {
    const files = [file(f, "added"), file("docs/PLAN.md")];
    assert.deepEqual(ids(await run({ pr: pr(), files })), ["architektur-nicht-angepasst"], f);
    assert.deepEqual(await run({ pr: pr(), files: [...files, file("docs/ARCHITECTURE.md")] }), [], f);
    assert.deepEqual(await run({ stufe: 1, pr: pr(), files }), [], f);
  }
});

test("pr: new top-level dir only when absent on base; docs/ does not count", async () => {
  const files = [file("services/api/main.ts", "added"), file("docs/PLAN.md")];
  assert.deepEqual(ids(await run({ pr: pr(), files, baseHasDir: async () => false })), ["architektur-nicht-angepasst"]);
  assert.deepEqual(await run({ pr: pr(), files, baseHasDir: async (d) => d === "services" }), []);
  const asked = [];
  await run({ pr: pr(), files: [file("docs/x.png", "added"), file("src/a.ts", "added"), file("docs/PLAN.md")], baseHasDir: async (d) => (asked.push(d), true) });
  assert.deepEqual(asked, ["src"]);
});

test("run: push event reports repo findings only; PR API failure degrades to warning", async () => {
  const ctx = makeCtx({ "AGENTS.md": agents(), "CLAUDE.md": "@AGENTS.md", "docs/PLAN.md": PLAN }, []);
  const push = await runStandard({ ctx, levelInput: "", pr: null, api: null });
  assert.equal(push.stufe, 2);
  assert.ok(ids(push.findings).includes("datei-fehlt"));
  const broken = { pullFiles: async () => { throw new Error("boom"); } }; // git failure
  const r = await runStandard({ ctx, levelInput: "", pr: { number: 1, body: "", author: "m", baseSha: "x" }, api: broken });
  const apiFinding = r.findings.find((f) => f.id === "pr-daten");
  assert.equal(apiFinding.severity, "warning");
  assert.equal(shouldFail([apiFinding], "enforce"), false);
});

test("run: dependabot PR does not fetch files; PR with code escalates design finding", async () => {
  const ctx = makeCtx({ ...fullFiles, "docs/PLAN.md": "# Plan\n" }, ["docs/decisions"]);
  const api = { pullFiles: async () => [file("src/a.ts"), file("docs/PLAN.md")], dirExists: async () => true };
  const r = await runStandard({ ctx, levelInput: "", pr: { number: 1, body: BODY, author: "m", baseSha: "b" }, api });
  assert.deepEqual(ids(r.findings), ["kein-code-vor-entwurf"]);
  const bot = { pullFiles: async () => assert.fail("not called") };
  await runStandard({ ctx, levelInput: "", pr: { number: 2, body: "", author: "dependabot[bot]", baseSha: "b" }, api: bot });
});

test("report: annotation escaping, summary, enforce vs warn", () => {
  const f = { id: "x", message: "a\nb 100%", file: "docs/A,B.md", severity: "error" };
  assert.equal(annotation(f), "::warning file=docs/A%2CB.md,title=standard%3A x::a%0Ab 100%25");
  assert.equal(shouldFail([f], "warn"), false);
  assert.equal(shouldFail([f], "enforce"), true);
  assert.equal(shouldFail([], "enforce"), false);
  const md = summaryMarkdown({ findings: [f], stufe: 2, source: "AGENTS.md", mode: "warn", event: "Push" });
  assert.match(md, /\| x \| a b 100% \| docs\/A,B.md \|/);
  assert.match(md, /Nicht geprüft/);
  assert.match(md, /RUNBOOK/);
});

test("git-diff: pullFiles and dirExists against a temp repo", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createGitClient } = await import("../standard/lib/git-diff.mjs");
  const dir = mkdtempSync(join(tmpdir(), "standard-git-"));
  const git = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.ch", ...a], { cwd: dir, encoding: "utf8" }).trim();
  try {
    git("init", "-q", "-b", "main");
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/a.ts"), "a");
    writeFileSync(join(dir, "gone.txt"), "x");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD");
    git("checkout", "-q", "-b", "feature");
    mkdirSync(join(dir, "services"));
    writeFileSync(join(dir, "services/b.ts"), "b");
    writeFileSync(join(dir, "src/a.ts"), "changed");
    git("rm", "-q", "gone.txt");
    git("add", "-A");
    git("commit", "-q", "-m", "feature");
    const client = createGitClient({ cwd: dir });
    const files = await client.pullFiles(1, base);
    assert.deepEqual(files.sort((x, y) => x.filename.localeCompare(y.filename)), [
      { filename: "gone.txt", status: "removed" },
      { filename: "services/b.ts", status: "added" },
      { filename: "src/a.ts", status: "modified" },
    ]);
    assert.equal(await client.dirExists("src", base), true);
    assert.equal(await client.dirExists("services", base), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
