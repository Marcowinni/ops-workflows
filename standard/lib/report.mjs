// Annotations, job summary and exit decision.

export const NOT_CHECKED = [
  "Build und Secret-Scan (Jobs checks / secret-scan der zentralen CI)",
  "diff-cover, Stryker, KI-Review",
  "Go-live-Punkte: docs/RUNBOOK.md, docs/audits/",
];

const escapeData = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProp = (s) => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

export function annotation(f) {
  const file = f.file ? `file=${escapeProp(f.file)},` : "";
  return `::warning ${file}title=${escapeProp(`standard: ${f.id}`)}::${escapeData(f.message)}`;
}

export function summaryMarkdown({ findings, stufe, source, mode, event }) {
  const head = [`## Check standard · Stufe ${stufe} (${source}) · ${event} · Modus ${mode}`, ""];
  const body = findings.length
    ? ["| Regel | Meldung | Datei |", "|---|---|---|", ...findings.map((f) => `| ${f.id} | ${cell(f.message)} | ${f.file ?? ""} |`)]
    : ["Keine Befunde."];
  const rest = ["", "**Nicht geprüft in diesem Schritt:**", ...NOT_CHECKED.map((n) => `- ${n}`)];
  if (mode === "warn" && findings.length) rest.push("", "Modus warn: Befunde sind Warnungen, der Schritt bleibt grün.");
  return [...head, ...body, ...rest, ""].join("\n");
}

export const shouldFail = (findings, mode) => mode === "enforce" && findings.some((f) => f.severity === "error");
