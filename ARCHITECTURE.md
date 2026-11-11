# Architektur

Fünf Actions plus ein Setup-Skript, je ein Ordner mit `action.yml` + `main.mjs` (Einstieg) + `lib/` (reine, getestete Logik). Keine Abhängigkeiten ausser Node 24.

| Ordner | Was | Rechte im Repo-Job |
|---|---|---|
| `maintain/` | Wartungslauf: Dependabot-PRs bewerten, Abgleich mit dem Business OS, mergen, Deploy-Hooks, Bericht | contents/pull-requests write, checks/statuses read |
| `smoke-http/` | HTTP-Funktionstest gegen Produktion | keine |
| `wait-deploy/` | wartet auf den Produktions-Deploy eines Commits (GitHub-Deployments von Vercel/Railway) | deployments read |
| `standard/` | Check `standard`: Text-/Dateiregeln des Coding-Standards (Pflichtdateien, Steckbrief, Design freigegeben, bei PRs Plan/Architektur/Beschreibung); Modus warn/enforce | contents read (PR-Daten aus git) |
| `standard/security-standard.md` | zentrale Fassung von Teil 1 der `docs/SECURITY.md`; `standard/main.mjs` lädt sie und übergibt sie der Regel `security-standard` | – |
| `setup/` | Skript `new-project.mjs` (läuft lokal bei Marco, nicht in CI): legt Repo aus `project-template` an, setzt Melde-Token, optional Deploy-Key + Rulesets (ADR 0052 Q53b); `lib/` reine Logik, Ausführung per injiziertem Runner | – |
| `verify-deploy/` | wertet den Test nach dem Deploy aus, rollt bei Rot zurück, meldet | contents write, deployments read |

Dazu ein wiederverwendbarer Workflow `.github/workflows/ci.yml` (zentrale CI für Pull Requests, Stufen `website` / `web_app` / `integrated_app`; Jobs `checks`, `standard`, `secret-scan`); er braucht keine eigene Logik in `lib/` und ruft `standard/` über den Tag `@v1` auf.

Gemeinsam genutzt (liegt in `maintain/lib/`, weil `maintain` der Kern ist): `profile.mjs` (`parseSteckbrief`, auch von `standard/`), `github.mjs` (REST-Client), `os-report.mjs` (Bericht an `solution_report`), `deploy-hooks.mjs`, `regression.mjs` (Regressions-Sperre). `verify-deploy` nutzt ausserdem `wait-deploy/lib/deployments.mjs` für den Deploy des Rollbacks.

## Datenfluss

Repo-Workflow `maintenance.yml`: `smoke` → `maintenance` (Output `merge-state`, `deployed-sha`) → `deploy` (wait-deploy) → `smoke-after` (gleiche Schritte wie `smoke`) → `verify-deploy`. Berichte gehen an das Business OS (`solution_report`): `maintain` zuerst als Abgleich (wartende PRs → Freigaben, Antwort: freigegebene PRs + Takt), dann Status + Nachweis; `verify-deploy` überschreibt danach `smoke_test` bzw. `deps_update`.

Zustand über Läufe hinweg liegt nur in GitHub: offene PRs, Commit-Status, Deployments und die Tags `ops-regression/*` (Regressions-Sperre). Das Business OS hat keinen Schreibzugriff auf Repos.
