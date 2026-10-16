// solution_report payload of the check after deploy (ADR 0044). Overwrites
// the status the maintenance run reported minutes before: red smoke →
// smoke_test fail, failed deploy → deps_update fail. Both block wave 2 in the
// OS until the next run is green again. A rollback keeps the status red: the
// update still needs someone to look at it.

const MAX_TEXT = 500;
const EXPECTED_EVERY_HOURS = 30; // same as the maintenance run

function cut(text) {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT - 1)}…`;
}

function listMerges(merges, withTitles) {
  const shown = merges.slice(0, 3).map((m) => (withTitles ? `#${m.number} ${m.title}` : `#${m.number}`));
  return merges.length > 3 ? `${shown.join(", ")} +${merges.length - 3}` : shown.join(", ");
}

const ROLLBACK_DEPLOY = {
  success: "Rollback live",
  failure: "Rollback-Deploy fehlgeschlagen — bitte prüfen",
  timeout: "Rollback-Deploy nicht bestätigt — bitte prüfen",
};

function rollbackText({ decision, rollback, rollbackDeploy, hookErrors, error }) {
  if (decision.blocker) return `kein Rollback: ${decision.blocker} — bitte prüfen`;
  if (!rollback) return `kein Rollback: Fehler (${error ?? "unbekannt"}) — bitte prüfen`;
  if (!rollback.done) return `kein Rollback: ${rollback.reason} — bitte prüfen`;
  const parts = [`automatisch zurückgerollt (${rollback.sha.slice(0, 7)})`];
  if (rollbackDeploy) parts.push(ROLLBACK_DEPLOY[rollbackDeploy.result] ?? "Rollback-Deploy unklar — bitte prüfen");
  else parts.push(`Rollback-Deploy nicht geprüft (Fehler: ${error ?? "unbekannt"}) — bitte prüfen`);
  if (hookErrors.length > 0) parts.push(`Deploy-Hook fehlgeschlagen (${hookErrors.length})`);
  if (!decision.lock) parts.push("ohne Regressions-Sperre (Deploy-Fehler kann vorübergehend sein)");
  if (rollback.lockError) parts.push("Regressions-Sperre fehlt (Tag nicht gesetzt)");
  return parts.join(", ");
}

/**
 * state: parsed merge-state · decision: decide() · rollback: rollBack() result or null
 * rollbackDeploy: waitForDeploy() result for the rollback commit or null
 * error: message of an API error during the rollback (the report goes out anyway)
 */
export function buildVerifyReport({ state, decision, deployDetail = "", rollback = null, rollbackDeploy = null, hookErrors = [], error = null, runUrl, repoUrl }) {
  const prs = listMerges(state.merges, false);
  const url = rollback?.done ? `${repoUrl}/commit/${rollback.sha}` : runUrl;
  const check = (kind, status, detail) => ({ kind, status, detail: cut(detail), url, expected_every_hours: EXPECTED_EVERY_HOURS });

  if (decision.outcome === "green") {
    return {
      checks: [check("smoke_test", "ok", `grün nach Update: ${prs}`)],
      events: [{ kind: "smoke_test", summary: cut(`Funktionstest nach Deploy grün: ${prs}`), url: runUrl }],
    };
  }
  if (decision.outcome === "untested") {
    // No smoke configured: keep maintain's smoke_test status ("missing"), log the deploy only.
    return { checks: [], events: [{ kind: "deps_update", summary: cut(`Deploy live nach Update: ${prs} (kein Funktionstest nach Deploy)`), url: runUrl }] };
  }
  if (decision.outcome === "unconfirmed") {
    let why = "Funktionstest nach Deploy nicht gelaufen (Einrichtung kaputt oder abgebrochen)";
    if (decision.deployConfirmed === false) why = deployDetail ? `Deploy nicht bestätigt (${deployDetail})` : "Deploy nicht bestätigt";
    return { checks: [check("smoke_test", "warn", `${why}: ${prs}`)], events: [] };
  }

  const text = rollbackText({ decision, rollback, rollbackDeploy, hookErrors, error });
  const [kind, what] = decision.outcome === "red"
    ? ["smoke_test", "Funktionstest rot nach Update"]
    : ["deps_update", "Deploy fehlgeschlagen nach Update (Produktion lief weiter auf dem alten Stand)"];
  const detail = `${what}: ${listMerges(state.merges, true)} · ${text}`;
  return {
    checks: [check(kind, "fail", detail)],
    events: [{ kind, summary: cut(detail), url }],
  };
}
