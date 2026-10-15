// Build the solution_report payload (TW Business OS, ADR 0044).
// One status per kind; events only for work actually done (merges). Waiting
// PRs travel in the sync call (schedule.mjs), not in the report.

const MAX_TEXT = 500;
const EXPECTED_EVERY_HOURS = 30; // daily run + slack; the OS flags silence after this

function cut(text) {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT - 1)}…`;
}

function listPrs(prs) {
  const shown = prs.slice(0, 3).map((p) => `#${p.number}${p.reason ? ` (${p.reason})` : ""}`);
  return prs.length > 3 ? `${shown.join(", ")} +${prs.length - 3}` : shown.join(", ");
}

function smokeCheck(smokeResult, runUrl) {
  const status = { success: "ok", failure: "fail", cancelled: "warn" }[smokeResult] ?? "missing";
  const detail = {
    ok: "Funktionstest grün",
    fail: "Funktionstest rot",
    warn: "Funktionstest abgebrochen",
    missing: "kein automatischer Funktionstest",
  }[status];
  return { kind: "smoke_test", status, detail, url: runUrl, expected_every_hours: EXPECTED_EVERY_HOURS };
}

function depsUpdateCheck(plan, merged, mergeErrors, deployErrors, runUrl, scheduleNote) {
  const failing = [...plan.failing, ...mergeErrors];
  const approvals = plan.approvals.filter((p) => p.kind === "deps_update");
  let status = "ok";
  let detail;
  let url = runUrl;
  if (failing.length > 0) {
    status = "fail";
    detail = `Updates rot: ${listPrs(failing)}`;
    url = failing[0].url;
  } else if (approvals.length > 0) {
    status = "pending_approval";
    detail = `Updates warten auf Klick: ${listPrs(approvals)}`;
    url = approvals[0].url;
  } else if (deployErrors.length > 0) {
    status = "warn";
    detail = `gemergt, aber Deploy-Hook fehlgeschlagen (${deployErrors.length})`;
  } else if (plan.stale.length > 0) {
    status = "warn";
    detail = `Updates hängen seit >3 Tagen: ${listPrs(plan.stale)}`;
    url = plan.stale[0].url;
  } else {
    const parts = [];
    if (merged.length) parts.push(`${merged.length} gemergt`);
    // Held for the wave is the plan working, not a problem: stays ok.
    if (plan.held?.length) parts.push(`${plan.held.length} warten auf Welle (${scheduleNote ?? "Takt"})`);
    if (plan.waiting.length) parts.push(`${plan.waiting.length} warten (Checks oder Lockfile)`);
    detail = parts.length ? parts.join(", ") : "keine offenen Updates";
  }
  return { kind: "deps_update", status, detail: cut(detail), url, expected_every_hours: EXPECTED_EVERY_HOURS };
}

function depsMajorCheck(plan, runUrl) {
  const majors = plan.approvals.filter((p) => p.kind === "deps_major");
  const blocked = plan.blocked ?? [];
  const blockedText = blocked.length ? `Checks rot, braucht Anpassung: ${listPrs(blocked)}` : "";
  if (majors.length === 0 && blocked.length === 0) {
    return { kind: "deps_major", status: "ok", detail: "keine Major-Updates offen", url: runUrl };
  }
  if (majors.length === 0) {
    return { kind: "deps_major", status: "warn", detail: cut(blockedText), url: blocked[0].url };
  }
  // Majors are bundled by the Business OS into one approval per repo and month.
  const waiting = `Major-Updates (Sammel-Freigabe pro Monat): ${majors.map((p) => `#${p.number} ${p.title}`).slice(0, 3).join("; ")}`;
  return {
    kind: "deps_major",
    status: "pending_approval",
    detail: cut(blockedText ? `${waiting} · ${blockedText}` : waiting),
    url: majors[0].url,
  };
}

export function buildReport({ plan, merged = [], mergeErrors = [], deployErrors = [], smokeResult, runUrl, scheduleNote }) {
  return {
    checks: [
      smokeCheck(smokeResult, runUrl),
      depsUpdateCheck(plan, merged, mergeErrors, deployErrors, runUrl, scheduleNote),
      depsMajorCheck(plan, runUrl),
    ],
    events: merged.map((pr) => ({
      kind: pr.kind ?? "deps_update",
      summary: cut(`PR #${pr.number} ${pr.approved ? "nach Freigabe" : "automatisch"} gemergt (${pr.bump}): ${pr.title}`),
      url: pr.url,
    })),
  };
}
