// Orchestration of all rules; I/O is injected so it stays testable.
import { finding } from "./finding.mjs";
import { resolveLevel } from "./level.mjs";
import { checkPr, codeChangedIn, isDependabot } from "./pr-rules.mjs";
import { checkRepo, parseSteckbrief } from "./repo-rules.mjs";

/**
 * ctx: { read, isDir }; pr: null | { number, body, author, baseSha };
 * api: { pullFiles(number, baseSha), dirExists(dir, ref) } (local git) (only used when pr is set).
 */
export async function runStandard({ ctx, levelInput, pr, api }) {
  const steckbrief = parseSteckbrief(ctx.read("AGENTS.md"));
  const level = resolveLevel({ levelInput, steckbrief });
  const findings = [...level.findings];

  let files = null;
  if (pr && !isDependabot(pr)) {
    try {
      files = await api.pullFiles(pr.number, pr.baseSha);
    } catch (e) {
      findings.push(finding("pr-daten", `PR-Dateien nicht lesbar (${e.message}): PR-Regeln übersprungen.`, null, "warning"));
    }
  }

  const codeChanged = files ? codeChangedIn(files) : false;
  findings.push(...checkRepo({ stufe: level.stufe, ctx, steckbrief, codeChanged }));

  if (files) {
    try {
      findings.push(...(await checkPr({ stufe: level.stufe, pr, files, baseHasDir: (dir) => api.dirExists(dir, pr.baseSha) })));
    } catch (e) {
      findings.push(finding("pr-daten", `Basis-Ordner nicht lesbar (${e.message}): PR-Regeln übersprungen.`, null, "warning"));
    }
  }
  return { findings, stufe: level.stufe, source: level.source };
}
