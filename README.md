# ops-workflows

Zentrale, versionierte Wartung für die Lösungen von TW Projects (ADR 0044 im TW Business OS).
Jedes Repo mit Paket «Wartung & Betreuung» ruft diese Action einmal täglich auf. Eine Änderung hier gilt für alle Repos, die `@v1` nutzen.

Das Repo ist öffentlich, damit es auch von öffentlichen Repos und nach einer Übergabe an den Kunden nutzbar bleibt. Es enthält keine Secrets.

## Was der Lauf tut

1. **Dependabot-PRs auswerten:** Art des Updates (Patch / Minor / Major), Stand der CI-Checks, Mergebarkeit.
2. **Auto-Merge-Grenze (ADR 0044 §4):** Ein Patch- oder Minor-Update wird ohne Klick gemergt, wenn alle diese Bedingungen erfüllt sind:
   - alle Pflicht-Checks (`required-checks`) sind grün,
   - kein Check ist rot,
   - der Funktionstest gegen Produktion ist grün.
   Pro Lauf werden höchstens PRs gemergt, die keine gemeinsame Datei ändern (Lockfile). Dependabot rebased den Rest, der nächste Lauf nimmt den nächsten.
3. **Braucht einen Klick:**
   - Major-Updates und Updates, deren Art unklar ist,
   - Updates, die `.github/workflows/` ändern (`GITHUB_TOKEN` darf keine Workflows ändern),
   - alle Updates, solange es keinen Funktionstest oder keine Pflicht-Checks gibt,
   - Updates, die der Test nach dem Deploy schon einmal zurückgerollt hat (Regressions-Sperre, siehe unten).
4. **Deploy:** Nach einem Merge werden die `deploy-hooks` ausgelöst. Grund: Ein Merge mit `GITHUB_TOKEN` löst keine Workflows aus, und Vercel deployt keine Commits von Dependabot.
5. **Bericht** an das Business OS (zuerst Status + wartende PRs, nach Merges ein zweiter mit Nachweis) (`solution_report`):
   - je ein Status für `smoke_test`, `deps_update` und `deps_major`,
   - ein Nachweis-Eintrag pro Merge.
   Bleibt der Bericht länger als 30 h aus, meldet das OS den Lauf als verstummt.
6. **Test nach dem Deploy** (empfohlen, eigene Jobs): Der Lauf wartet auf den Produktions-Deploy des Merges, prüft mit demselben Funktionstest erneut und rollt bei Rot automatisch zurück. Siehe [Test nach dem Deploy](#test-nach-dem-deploy-mit-auto-rollback).

## Takt in Wellen

Geprüft wird täglich, Updates kommen in Wellen (ADR 0044 §4). Der Lauf fragt jeden Tag zuerst das Business OS ab («Abgleich»). Die Welle steht im Register, nicht im Repo.

| | ohne Klick gemergt |
|---|---|
| Welle 1 (eigene Apps) | Patch/Minor am Montag |
| Welle 2 (Kunden mit Paket) | Patch/Minor am Mittwoch, nur wenn Welle 1 grün ist |
| immer | Dependabot-Gruppe `security`, jeden Tag |
| ohne Paket | nichts |

Majors kommen als **eine Sammel-Freigabe pro Repo und Monat**, ab dem ersten Wellentag des Monats. Damit die Montags-Welle die PRs der Woche sieht, öffnet Dependabot sie montags früh (`time` in `dependabot.yml`).

## Freigaben (Stufe 2, Pull-Modell)

Im Abgleich meldet der Lauf jeden PR, der einen Klick braucht. Das Business OS legt dafür Freigaben in der Inbox «Freigaben» an: für Sicherheits-Updates und für Updates ohne Funktionstest eine pro PR und Titel, für Majors eine Sammel-Freigabe pro Monat. Ändert Dependabot die Version eines PRs, braucht es ein neues OK.

Nach dem OK durch Marco oder Till verläuft es so:
1. Die Antwort auf den nächsten Bericht nennt den PR als `approved`.
2. Der Lauf merged ihn mit dem eigenen `GITHUB_TOKEN`. Voraussetzung: Die Checks sind grün und der PR ist mergebar.
3. Das OS selbst hat keinen Schreibzugriff auf Repos.

Weitere Regeln:
- Ist ein PR geschlossen oder gemergt, zieht das OS die offene Freigabe zurück.
- PRs, die `.github/workflows/` ändern, erscheinen nicht in der Inbox. Sie werden in GitHub gemergt.

## Einbinden

```yaml
# .github/workflows/maintenance.yml
name: Wartung
on:
  schedule:
    - cron: "17 5 * * *"
  workflow_dispatch:

permissions: {}

jobs:
  smoke:
    name: Funktionstest Produktion
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v7
      - run: echo "Hier den automatischen Funktionstest gegen Produktion ausführen (z.B. pnpm smoke)."

  maintenance:
    name: Wartung
    needs: smoke
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: write
      pull-requests: write
      checks: read
      statuses: read
    steps:
      - uses: Marcowinni/ops-workflows/maintain@v1
        with:
          report-token: ${{ secrets.OPS_REPORT_TOKEN }}
          smoke-result: ${{ needs.smoke.result }}
          required-checks: |
            test
          deploy-hooks: ${{ secrets.VERCEL_DEPLOY_HOOK }}
```

Ohne Smoke-Job `smoke-result` weglassen: Der Lauf meldet dann «kein automatischer Funktionstest», und kein Update geht ohne Klick live.

## Funktionstest ohne E2E: `smoke-http`

Für Lösungen ohne eigenen E2E-Test gibt es einen HTTP-Smoke als Startpunkt. Jede Seite muss mit 2xx antworten und den erwarteten Text enthalten. Ein echter Hauptablauf-Test bleibt das Ziel (Vorlage, QUALITY W02).

```yaml
      - uses: Marcowinni/ops-workflows/smoke-http@v1
        with:
          checks: |
            https://www.example.ch | Willkommen
            https://www.example.ch/kontakt | Kontakt
```

`attempts: 2` prüft rote Seiten nach `retry-delay-seconds` (Standard 60) ein zweites Mal. Für den Test nach dem Deploy empfohlen: Dort löst Rot einen Rollback aus, ein einzelner Netz-Aussetzer soll das nicht.

## Test nach dem Deploy mit Auto-Rollback

Der Funktionstest vor dem Merge prüft die alte Version. Ohne zweiten Test fällt ein Update, das Produktion bricht, erst im nächsten Lauf auf (bis 24 h). Deshalb nach jedem Merge (Entscheid Marco 2026-10-16, Option C):

1. **`wait-deploy`** wartet auf den Produktions-Deploy des Merge-Commits. Vercel (`Production`, `Production – <projekt>`) und Railway (`<projekt> / production`) melden ihre Deploys an GitHub, darum reicht `GITHUB_TOKEN` mit `deployments: read`, kein Hosting-Token. Pro Umgebung zählt der neueste Deploy; erst wenn sich 60 s nichts mehr ändert, gilt er als fertig. Timeout 15 min.
2. **Derselbe Funktionstest** läuft gegen die neue Version (YAML-Anker: eine Definition für beide Jobs).
3. **`verify-deploy`** wertet aus und meldet an das Business OS:
   - grün → `smoke_test` ok mit den PR-Nummern, Nachweis-Eintrag,
   - Funktionstest rot → `smoke_test` fail, **Rollback**,
   - Deploy fehlgeschlagen → `deps_update` fail, **Rollback** (Produktion läuft noch alt, der Branch muss aber deploybar bleiben),
   - Deploy nicht bestätigt (Timeout) oder Test abgebrochen → `smoke_test` warn, kein Rollback,
   - kein Funktionstest eingerichtet (Job übersprungen) → nur Nachweis «Deploy live», Status bleibt «kein automatischer Funktionstest».

   Rot sperrt im OS die Welle 2, bis ein Lauf wieder grün ist. Der Status bleibt auch nach einem Rollback rot, weil jemand das Update anschauen muss.

**Rollback:** ein neuer Commit auf dem Default-Branch mit dem Stand vor dem Merge, per Fast-Forward. Danach Deploy-Hooks und Warten auf den Deploy des Rollbacks. Git und Produktion bleiben gleich. Ein Revert-PR geht nicht, weil `GITHUB_TOKEN` in unseren Repos keine PRs öffnen darf. Schutzregeln:
- nur wenn der Funktionstest **vor** dem Merge grün war (sonst kommt Rot vielleicht nicht vom Update),
- nur die Merges dieses Laufs: Zwischen Stand vorher und Kopf dürfen keine fremden Commits liegen, und der Branch darf sich seit dem Merge nicht bewegt haben, sonst nur Meldung,
- `rollback: false` schaltet ihn ab (nur melden).

**Regressions-Sperre:** Der Rollback-Commit nennt jede zurückgerollte Version (`ops-regression: paket@version`) und bekommt den Tag `ops-regression/<lauf>`. Öffnet Dependabot dasselbe Update neu, merged der Lauf es nicht mehr automatisch, sondern legt es als Freigabe vor. Eine neuere Version ist frei. Tag löschen hebt die Sperre auf.

Einbinden: die Jobs `smoke` und `maintenance` wie oben, dazu:

```yaml
jobs:
  smoke:
    # … wie oben, aber die Schritte mit Anker:
    steps: &smoke-steps
      - uses: Marcowinni/ops-workflows/smoke-http@v1
        with:
          attempts: 2
          checks: |
            https://www.example.ch | Willkommen

  maintenance:
    # … wie oben, plus:
    outputs:
      deployed-sha: ${{ steps.maintain.outputs.deployed-sha }}
      merge-state: ${{ steps.maintain.outputs.merge-state }}
    steps:
      - id: maintain
        uses: Marcowinni/ops-workflows/maintain@v1
        with: # … wie oben

  deploy:
    name: Warten auf Deploy
    needs: maintenance
    if: ${{ needs.maintenance.outputs.deployed-sha != '' }}
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      deployments: read
    outputs:
      result: ${{ steps.wait.outputs.result }}
      detail: ${{ steps.wait.outputs.detail }}
    steps:
      - id: wait
        uses: Marcowinni/ops-workflows/wait-deploy@v1
        with:
          sha: ${{ needs.maintenance.outputs.deployed-sha }}

  smoke-after:
    name: Funktionstest nach Deploy
    needs: deploy
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
    steps: *smoke-steps

  verify-deploy:
    name: Test nach Deploy auswerten
    needs: [smoke, maintenance, deploy, smoke-after]
    if: ${{ !cancelled() && needs.maintenance.outputs.deployed-sha != '' }}
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: write
      deployments: read
    steps:
      - uses: Marcowinni/ops-workflows/verify-deploy@v1
        with:
          report-token: ${{ secrets.OPS_REPORT_TOKEN }}
          merge-state: ${{ needs.maintenance.outputs.merge-state }}
          pre-smoke-result: ${{ needs.smoke.result }}
          deploy-result: ${{ needs.deploy.outputs.result }}
          deploy-detail: ${{ needs.deploy.outputs.detail }}
          smoke-result: ${{ needs.smoke-after.result }}
          deploy-hooks: ${{ secrets.VERCEL_DEPLOY_HOOK }}
```

Warum vier Jobs statt einem: Der Funktionstest führt Repo-Code mit frisch aktualisierten Paketen aus (`npm ci`). Er läuft darum nur mit Leserechten; den Schreib-Token für den Rollback sieht nur `verify-deploy`, das keinen Repo-Code ausführt. Mehrere Vercel-Projekte in einem Repo: `min-deployments` (Anzahl Projekte) oder `environments` bei `wait-deploy` und `verify-deploy` setzen. Hat `smoke` eine Job-Bedingung (`if:`), braucht `smoke-after` dieselbe — sonst laufen leere Schritte und gelten als grün.

## Melde-Token einrichten

Der Token liegt nur als Secret im Repo. Das Business OS kennt nur seinen sha256.

```bash
TOKEN=$(openssl rand -hex 32)
HASH=$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)
# 1) Business OS: update_solution { solution_id, report_token_hash: "$HASH" }
#    (gilt für alle Lösungen mit derselben repo_url)
# 2) Repo:
gh secret set OPS_REPORT_TOKEN --repo Marcowinni/<repo> --body "$TOKEN"
```

## Versionen

`v1` zeigt auf den neuesten kompatiblen Stand und wird bei Änderungen nachgezogen. Inkompatible Änderungen (Inputs, Bericht-Format) gibt es nur als `v2`.

## Entwicklung

Aufbau und Datenfluss: [ARCHITECTURE.md](ARCHITECTURE.md).

```bash
node --test
```
