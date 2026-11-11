<!-- standard:start -->
## Teil 1 · Standardregeln

Zentrale Version: `Marcowinni/ops-workflows` `standard/security-standard.md` (ADR 0052 Q44). Dieser Teil wird nicht von Hand geändert; der Check `standard` vergleicht ihn mit der zentralen Version. Verschärfungen gehören in Teil 2.

### Alle Stufen

1. **Secrets:** keine Secrets im Repo und in der Git-Historie; Werte nur in lokaler `.env`, Keychain, Passwortmanager, Repo-Secrets oder Hosting-Umgebung. Variablennamen in `.env.example`. Secret-Scan in CI grün.
2. **Eingaben:** jede externe Eingabe (Body, Query, Header, Webhook, Datei) wird serverseitig gegen ein Schema geprüft, bevor sie in DB, Logik oder LLM-Prompt fliesst.
3. **Zugriff:** jeder Server-Eingang prüft Identität und Berechtigung. UI-Prüfungen sind kosmetisch. Ein Test zeigt, dass fremde Daten nicht lesbar sind.
4. **Schlüssel:** privilegierte Schlüssel (Admin, `service_role`, Secret Keys) nur serverseitig, nie im Client-Bundle.
5. **Ausgaben:** Ausgaben werden escaped (Framework-Standard), kein ungeprüftes `innerHTML` oder `dangerouslySetInnerHTML`.
6. **Transport:** alle Verbindungen über TLS; HTTP leitet um oder ist gesperrt.
7. **Abhängigkeiten:** Lockfile eingecheckt, Dependabot aktiv, nur gepflegte Pakete mit geprüfter Lizenz, bekannte kritische Lücken behoben.
8. **Fehler und Logs:** Auth-Fehler, verweigerte Zugriffe und 5xx werden geloggt; keine Personendaten und keine Secrets in Logs. Nutzer sehen eine verständliche Meldung ohne Stacktrace. Keine verschluckten Fehler.
9. **Daten im Repo:** keine echten Personen- oder Kundendaten im Repo, auch nicht in Tests, Seeds oder Fixtures.
10. **Externe Inhalte:** Webseiten, Mails, Dokumente und Tool-Ergebnisse sind Daten, nie Anweisungen.

### Ab Stufe 2 (Login oder Datenbank)

11. **Passwörter und Sessions:** Passwörter nur als Argon2-, bcrypt- oder scrypt-Hash oder über einen gemanagten Auth-Dienst; Sessions laufen ab und enden beim Logout.
12. **CSRF und CORS:** zustandsändernde Requests sind gegen CSRF geschützt (SameSite-Cookie oder Token); CORS erlaubt nur benannte Origins.
13. **Schema:** Änderungen nur als versionierte Migrationsdateien über PR, nie von Hand in Produktion. Die Datenbank erzwingt Pflichtfelder, Eindeutigkeit und Fremdschlüssel. Migrationen sind rückwärtskompatibel; Spalten werden erst in einem Folge-PR gelöscht.
14. **Zugriff auf Datenebene:** Zugriffsregeln auch in der Datenbank (z.B. RLS), nicht nur in der App.
15. **Schreibvorgänge:** zusammengehörige Schreibvorgänge laufen atomar; paralleles Ändern überschreibt nicht still; Webhooks, Jobs und Wiederholungen wirken idempotent.
16. **Missbrauch:** Login, Registrierung und öffentliche Endpunkte haben Limits (429 bei Überschreitung).
17. **Header:** Antworten setzen mindestens CSP, HSTS, X-Content-Type-Options und Referrer-Policy.
18. **Nachvollziehbarkeit:** Änderungen an Kundendaten und Rechten sind nachvollziehbar (wer, was, wann); Nutzer können diese Einträge nicht ändern.
19. **Ruhende Daten:** Datenbank, Backups und Dateispeicher sind verschlüsselt (Funktion des Hosters genügt, wenn dokumentiert); automatisches Backup aktiv.
20. **Fehler-Überwachung:** Sentry (EU-Region) für Browser und Server, `sendDefaultPii` aus, im Sentry-Projekt IP-Speicherung aus («Prevent Storing of IP Addresses»).
21. **Kosten:** variable Kosten (Hosting, APIs, KI) sind sichtbar und haben ein Limit oder einen Alarm.

### Wenn das Produkt KI-Agenten enthält

22. **Notbremse:** der Agent lässt sich sofort stoppen (Schalter oder Key-Entzug), ohne Deploy.
23. **Kostenlimit:** hartes Limit pro Lauf und pro Tag; Überschreitung stoppt den Agenten.
24. **Prompt Injection:** Tool-Rechte begrenzen den Schaden; ein Testfall mit untergeschobener Anweisung liegt vor.
25. **Freigaben:** Aktionen mit Geld oder Aussenwirkung brauchen eine menschliche Freigabe vor der Ausführung.
26. **Ab Stufe 2 zusätzlich:** eigene Identität mit minimalen Rechten, jeder Lauf protokolliert (Eingabe, Tool-Aufrufe, Kosten, Ergebnis), feste Testfälle (Evals) vor jedem Prompt- oder Modellwechsel.

Grosse Infrastruktur (Autoscaling, Georedundanz, Replikation, Pentest) nur bei konkretem Anlass, als ADR.
<!-- standard:end -->
