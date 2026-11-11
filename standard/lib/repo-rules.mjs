// Repo-state rules 1-4: files, AGENTS.md/Steckbrief, design approved (Q45).
// ctx: { read(path) -> string|null, isDir(path) -> boolean }.
import { parseSteckbrief } from "../../maintain/lib/profile.mjs";
import { finding } from "./finding.mjs";
import { contentLines, sectionContent } from "./markdown.mjs";

const MAX_AGENTS_LINES = 150;
const REQUIRED_FIELDS = ["name", "typ", "business_ref", "daten", "solution_type", "paket", "stack", "befehle", "zweck", "kunde", "ausnahmen"];
const OBSOLETE_FIELDS = ["qualitaet", "status_datei", "personal_ref"];

export { parseSteckbrief };

const hasField = (steckbrief, key) => key in steckbrief || Object.keys(steckbrief).some((k) => k.startsWith(`${key}.`));

export function checkFiles({ stufe, ctx }) {
  const out = [];
  const required = ["AGENTS.md", "CLAUDE.md", "docs/PLAN.md"];
  if (stufe >= 2) required.push("docs/ARCHITECTURE.md", "docs/SECURITY.md");
  for (const file of required) {
    if (ctx.read(file) === null) out.push(finding("datei-fehlt", `Datei fehlt: ${file}`, file));
  }
  if (stufe >= 2 && !ctx.isDir("docs/decisions")) out.push(finding("datei-fehlt", "Ordner fehlt: docs/decisions/", "docs/decisions"));
  const claude = ctx.read("CLAUDE.md");
  if (claude !== null && claude.replace(/\s+/g, "") !== "@AGENTS.md") {
    out.push(finding("claude-md-inhalt", "CLAUDE.md darf nur «@AGENTS.md» enthalten.", "CLAUDE.md"));
  }
  return out;
}

export function checkAgents({ agentsMd, steckbrief }) {
  if (agentsMd === null) return [];
  const out = [];
  const lines = agentsMd.trimEnd().split("\n").length;
  if (lines > MAX_AGENTS_LINES) {
    out.push(finding("agents-zu-lang", `AGENTS.md hat ${lines} Zeilen (max. ${MAX_AGENTS_LINES}).`, "AGENTS.md"));
  }
  if (!steckbrief) {
    out.push(finding("steckbrief-fehlt", "Kein Steckbrief (yaml-Block) in AGENTS.md.", "AGENTS.md"));
    return out;
  }
  const missing = REQUIRED_FIELDS.filter((k) => !hasField(steckbrief, k));
  if (missing.length) out.push(finding("steckbrief-felder", `Steckbrief: Felder fehlen: ${missing.join(", ")}.`, "AGENTS.md"));
  const obsolete = OBSOLETE_FIELDS.filter((k) => hasField(steckbrief, k));
  if (obsolete.length) out.push(finding("steckbrief-veraltet", `Steckbrief: veraltete Felder entfernen: ${obsolete.join(", ")}.`, "AGENTS.md"));
  return out;
}

/** Q45: no code before an approved design. codeChanged = PR changes code. */
export function checkDesign({ stufe, steckbrief, ctx, codeChanged = false }) {
  const reasons = [];
  const open = Object.entries(steckbrief ?? {}).filter(([, v]) => v.replace(/^["']|["']$/g, "").trim().toLowerCase() === "offen");
  if (open.length) reasons.push(`Steckbrief-Felder offen: ${open.map(([k]) => k).join(", ")}`);
  if (sectionContent(ctx.read("docs/PLAN.md"), /ziel/i).length === 0) reasons.push("docs/PLAN.md: kein Inhalt unter «Ziel»");
  if (stufe >= 2 && contentLines(ctx.read("docs/ARCHITECTURE.md")).length < 3) {
    reasons.push("docs/ARCHITECTURE.md fehlt oder hat weniger als 3 Inhaltszeilen");
  }
  if (!reasons.length) return [];
  const detail = reasons.join("; ");
  if (codeChanged) return [finding("kein-code-vor-entwurf", `Kein Code vor Entwurf: Design nicht freigegeben (${detail}).`, "docs/PLAN.md")];
  return [finding("design-nicht-freigegeben", `Design nicht freigegeben: ${detail}.`, "docs/PLAN.md")];
}

export function checkRepo({ stufe, ctx, steckbrief, codeChanged = false }) {
  return [
    ...checkFiles({ stufe, ctx }),
    ...checkAgents({ agentsMd: ctx.read("AGENTS.md"), steckbrief }),
    ...checkDesign({ stufe, steckbrief, ctx, codeChanged }),
  ];
}
