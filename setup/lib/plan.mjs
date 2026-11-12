// Pure plan: which commands run, in which order. Secrets are placeholders
// ({ ref }) that the executor resolves; nothing here holds a real secret.
import { mainProtectionRuleset } from "./rulesets.mjs";

export const ref = (name, show) => ({ ref: name, show });
export const isRef = (x) => typeof x === "object" && x !== null && "ref" in x;

const gh = (...argv) => ["gh", ...argv];

export function buildPlan({ owner, name, template, protect }) {
  const slug = `${owner}/${name}`;
  const steps = [
    {
      id: "repo",
      label: "Repo aus Vorlage anlegen und klonen",
      cleanup: `Repo löschen: gh repo delete ${slug}; lokalen Ordner ./${name} entfernen.`,
      commands: [{ argv: gh("repo", "create", slug, "--template", template, "--private", "--clone") }],
    },
    {
      id: "report-token",
      label: "Melde-Token als Secret OPS_REPORT_TOKEN setzen",
      cleanup: `Secret entfernen: gh secret delete OPS_REPORT_TOKEN -R ${slug}`,
      commands: [{ argv: gh("secret", "set", "OPS_REPORT_TOKEN", "-R", slug), stdin: ref("report-token", "<token>") }],
    },
  ];
  if (protect) {
    steps.push(
      {
        id: "deploy-key",
        label: "Deploy-Key erzeugen, eintragen, als Secret OPS_DEPLOY_KEY setzen",
        usesTmpdir: true,
        cleanup: `Deploy-Key «ops-deploy» in den Repo-Einstellungen löschen; Secret entfernen: gh secret delete OPS_DEPLOY_KEY -R ${slug}`,
        commands: [
          { argv: ["ssh-keygen", "-t", "ed25519", "-N", "", "-C", `ops-deploy-${name}`, "-f", ref("keyfile", "<tmpdir>/key")] },
          { argv: gh("api", "-X", "POST", `repos/${slug}/keys`, "-f", "title=ops-deploy", "-f", ref("key-field", "key=<public-key>"), "-F", "read_only=false") },
          { argv: gh("secret", "set", "OPS_DEPLOY_KEY", "-R", slug), stdin: ref("deploy-private-key", "<private-key>") },
        ],
      },
      {
        id: "rulesets",
        label: "Ruleset main-schutz anlegen",
        cleanup: `Ruleset in den Repo-Einstellungen löschen (Settings > Rules > Rulesets) in ${slug}.`,
        commands: [mainProtectionRuleset()].map((ruleset) => ({
          argv: gh("api", "-X", "POST", `repos/${slug}/rulesets`, "--input", "-"),
          stdin: JSON.stringify(ruleset),
        })),
      },
    );
  }
  return steps;
}
