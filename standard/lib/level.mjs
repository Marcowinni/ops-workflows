// Stufe (Q42): derived from solution_type in the Steckbrief, or the `level` input.
import { finding } from "./finding.mjs";

const BY_TYPE = {
  website: 1,
  web_app: 2,
  integrated_app: 3,
  ai_workspace: 3,
  ai_process: 3,
  platform: 3,
};

const BY_LEVEL_INPUT = { ...BY_TYPE, 1: 1, 2: 2, 3: 3 };

/** Returns { stufe: 1|2|3, source, findings }. Unknown never guesses stricter. */
export function resolveLevel({ levelInput = "", steckbrief = null }) {
  const override = String(levelInput ?? "").trim().toLowerCase();
  const findings = [];
  if (override) {
    if (override in BY_LEVEL_INPUT) return { stufe: BY_LEVEL_INPUT[override], source: "input", findings };
    findings.push(finding("stufe-unbekannt", `Eingabe level «${override}» ist ungültig, Stufe wird aus AGENTS.md gelesen.`));
  }
  const type = (steckbrief?.solution_type ?? "").trim().toLowerCase();
  if (type in BY_TYPE) return { stufe: BY_TYPE[type], source: "AGENTS.md", findings };
  findings.push(
    finding(
      "stufe-unbekannt",
      `${type ? `solution_type «${type}» ist keine bekannte Stufe` : "solution_type fehlt"}: Stufe 1 angenommen. In AGENTS.md setzen oder level übergeben.`,
      "AGENTS.md",
    ),
  );
  return { stufe: 1, source: "Standard", findings };
}
