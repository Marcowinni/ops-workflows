// PR-only rules 5-8. files: [{ filename, status }]; pr: { body, author }.
// baseHasDir(dir) -> Promise<boolean> asks the base ref (REST contents API).
import { finding } from "./finding.mjs";

const PR_FIELDS = ["Arbeitspaket", "Was und warum", "Beweis", "Nicht geprüft"];
const SERVICE_FILE = /^(docker-compose[^/]*\.ya?ml|railway\.(json|toml)|vercel\.json|Dockerfile)$/;
const NOT_STRUCTURAL_DIRS = new Set(["docs", ".github"]);

export const isCode = (path) => !path.startsWith("docs/") && !path.toLowerCase().endsWith(".md") && !path.startsWith(".github/");
export const isDependabot = (pr) => pr.author === "dependabot[bot]";

const hasPlanOptOut = (body) => /^\s*plan:\s*unver(ä|ae)ndert\b/im.test(body ?? "");

function hasField(body, field) {
  const name = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  return new RegExp(`^\\s*(?:#{1,6}\\s+|[-*]\\s+)?\\**${name}\\**\\s*(?::|$)`, "im").test(body ?? "");
}

function isServiceDefinition(path) {
  return path === "supabase/config.toml" || SERVICE_FILE.test(path.split("/").pop());
}

export function codeChangedIn(files) {
  return files.some((f) => isCode(f.filename));
}

async function structuralChanges(files, baseHasDir) {
  const reasons = [];
  if (files.some((f) => /(^|\/)migrations\//.test(f.filename))) reasons.push("Migration");
  if (files.some((f) => isServiceDefinition(f.filename))) reasons.push("Service-Definition");
  const dirs = new Set(files.filter((f) => f.status === "added" && f.filename.includes("/")).map((f) => f.filename.split("/")[0]));
  for (const dir of dirs) {
    if (NOT_STRUCTURAL_DIRS.has(dir)) continue;
    if (!(await baseHasDir(dir))) reasons.push(`neuer Top-Level-Ordner ${dir}/`);
  }
  return reasons;
}

export async function checkPr({ stufe, pr, files, baseHasDir }) {
  if (isDependabot(pr)) return [];
  const out = [];
  const changed = new Set(files.map((f) => f.filename));
  const codeChanged = codeChangedIn(files);
  if (codeChanged && !changed.has("docs/PLAN.md") && !hasPlanOptOut(pr.body)) {
    out.push(finding("plan-nicht-angepasst", "Code geändert, aber docs/PLAN.md nicht. Plan nachführen oder «plan: unverändert» in die PR-Beschreibung.", "docs/PLAN.md"));
  }
  if (codeChanged) {
    const missing = PR_FIELDS.filter((f) => !hasField(pr.body, f));
    if (missing.length) out.push(finding("pr-felder", `PR-Beschreibung: Felder fehlen: ${missing.join(", ")}.`));
  }
  if (stufe >= 2 && !changed.has("docs/ARCHITECTURE.md")) {
    const reasons = await structuralChanges(files, baseHasDir);
    if (reasons.length) {
      out.push(finding("architektur-nicht-angepasst", `Strukturelle Änderung (${reasons.join(", ")}), aber docs/ARCHITECTURE.md nicht angepasst.`, "docs/ARCHITECTURE.md"));
    }
  }
  return out;
}
