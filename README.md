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
   - alle Updates, solange es keinen Funktionstest oder keine Pflicht-Checks gibt.
4. **Deploy:** Nach einem Merge werden die `deploy-hooks` ausgelöst. Grund: Ein Merge mit `GITHUB_TOKEN` löst keine Workflows aus, und Vercel deployt keine Commits von Dependabot.
5. **Bericht** an das Business OS (zuerst Status + wartende PRs, nach Merges ein zweiter mit Nachweis) (`solution_report`):
   - je ein Status für `smoke_test`, `deps_update` und `deps_major`,
   - ein Nachweis-Eintrag pro Merge.
   Bleibt der Bericht länger als 30 h aus, meldet das OS den Lauf als verstummt.

## Freigaben (Stufe 2, Pull-Modell)

Der Lauf meldet jeden PR, der einen Klick braucht, mit Nummer, Titel und Link. Das Business OS legt dafür eine Freigabe in der Inbox «Freigaben» an, und zwar eine pro PR und Titel. Ändert Dependabot die Version im PR, braucht es ein neues OK.

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

```bash
node --test
```
