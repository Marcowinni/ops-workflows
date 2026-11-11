// Human-readable output: dry-run plan, failure report, final summary (German).
import { isRef } from "./plan.mjs";

const quote = (s) => (/^[\w@%+=:,./~-]+$/.test(s) ? s : JSON.stringify(s));
const show = (arg) => (isRef(arg) ? arg.show : arg);

export function formatCommand(command) {
  const line = command.argv.map((a) => quote(show(a))).join(" ");
  if (command.stdin === undefined) return line;
  return `${line}\n      < stdin: ${isRef(command.stdin) ? command.stdin.show : command.stdin}`;
}

export function formatPlan(steps) {
  return steps.flatMap((step, i) => [`${i + 1}. ${step.label}`, ...step.commands.map((c) => `   $ ${formatCommand(c)}`)]).join("\n");
}

export function formatFailure(error, steps) {
  const cleanup = [...(error.done ?? []), error.failed?.id].filter(Boolean).map((id) => steps.find((s) => s.id === id)?.cleanup).filter(Boolean);
  return [
    error.message,
    `Bereits ausgeführt: ${error.done?.length ? error.done.join(", ") : "nichts"}.`,
    "Kein automatischer Neuversuch. Manuell aufräumen:",
    ...cleanup.map((c) => `  - ${c}`),
  ].join("\n");
}

export function formatSummary({ owner, name, tokenHash, protect }) {
  return [
    "",
    "Fertig.",
    `  Repo:              https://github.com/${owner}/${name}`,
    `  report_token_hash: ${tokenHash}`,
    `  Schutz (--protect): ${protect ? "ja" : "nein"}`,
    "",
    "Nächste Schritte für den Agenten:",
    '  1. Register-Eintrag im Business OS: dispatch_action("create_solution") mit name, customer_id,',
    `     solution_type, care_status und repo_url=https://github.com/${owner}/${name}. customer_id nie raten:`,
    "     bei typ: eigen die eigene Firma als Kunde auflösen, sonst nachfragen.",
    '     Danach dispatch_action("update_solution") mit status: paused und report_token_hash (oben).',
    "     Feldnamen vorher mit describe_action prüfen.",
    "  2. Steckbrief in AGENTS.md ausfüllen.",
    "  3. Ziel klären (Skill software-projekt, «Neues Projekt»).",
  ].join("\n");
}
