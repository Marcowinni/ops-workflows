# Architektur

Vier Actions, je ein Ordner mit `action.yml` + `main.mjs` (Einstieg) + `lib/` (reine, getestete Logik). Keine Abhängigkeiten ausser Node 24.

| Ordner | Was | Rechte im Repo-Job |
|---|---|---|
| `maintain/` | Wartungslauf: Dependabot-PRs bewerten, Abgleich mit dem Business OS, mergen, Deploy-Hooks, Bericht | contents/pull-requests write, checks/statuses read |
| `smoke-http/` | HTTP-Funktionstest gegen Produktion | keine |
| `wait-deploy/` | wartet auf den Produktions-Deploy eines Commits (GitHub-Deployments von Vercel/Railway) | deployments read |
| `verify-deploy/` | wertet den Test nach dem Deploy aus, rollt bei Rot zurück, meldet | contents write, deployments read |

Gemeinsam genutzt (liegt in `maintain/lib/`, weil `maintain` der Kern ist): `github.mjs` (REST-Client), `os-report.mjs` (Bericht an `solution_report`), `deploy-hooks.mjs`, `regression.mjs` (Regressions-Sperre). `verify-deploy` nutzt ausserdem `wait-deploy/lib/deployments.mjs` für den Deploy des Rollbacks.

## Datenfluss

Repo-Workflow `maintenance.yml`: `smoke` → `maintenance` (Output `merge-state`, `deployed-sha`) → `deploy` (wait-deploy) → `smoke-after` (gleiche Schritte wie `smoke`) → `verify-deploy`. Berichte gehen an das Business OS (`solution_report`): `maintain` zuerst als Abgleich (wartende PRs → Freigaben, Antwort: freigegebene PRs + Takt), dann Status + Nachweis; `verify-deploy` überschreibt danach `smoke_test` bzw. `deps_update`.

Zustand über Läufe hinweg liegt nur in GitHub: offene PRs, Commit-Status, Deployments und die Tags `ops-regression/*` (Regressions-Sperre). Das Business OS hat keinen Schreibzugriff auf Repos.
