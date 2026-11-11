// Executes a plan through an injected runner. Stops at the first failure and
// never retries. runner(argv, { input }) -> stdout, throws on non-zero exit.
import { createHash, randomBytes } from "node:crypto";
import { isRef } from "./plan.mjs";

export const sha256Hex = (text) => createHash("sha256").update(text).digest("hex");
export const newReportToken = () => randomBytes(32).toString("hex");

const resolve = (value, values) => {
  if (!isRef(value)) return value;
  if (!(value.ref in values)) throw new Error(`Interner Fehler: Wert «${value.ref}» fehlt.`);
  return values[value.ref];
};

/** fsDeps: { mkdtemp(), read(path), remove(dir) } injected for tests. */
export function executePlan({ steps, runner, token, fsDeps }) {
  const done = [];
  const values = { "report-token": token };
  for (const step of steps) {
    let tmpdir = null;
    try {
      if (step.usesTmpdir) {
        tmpdir = fsDeps.mkdtemp();
        values.keyfile = `${tmpdir}/key`;
      }
      step.commands.forEach((command, index) => {
        runner(command.argv.map((a) => resolve(a, values)), { input: command.stdin === undefined ? undefined : resolve(command.stdin, values) });
        if (step.usesTmpdir && index === 0) {
          values["deploy-private-key"] = fsDeps.read(values.keyfile);
          values["key-field"] = `key=${fsDeps.read(`${values.keyfile}.pub`).trim()}`;
        }
      });
      done.push(step.id);
    } catch (error) {
      const failure = new Error(`Schritt «${step.id}» fehlgeschlagen: ${scrub(error.message, values)}`);
      failure.done = done;
      failure.failed = step;
      throw failure;
    } finally {
      if (tmpdir) fsDeps.remove(tmpdir);
    }
  }
  return done;
}

function scrub(message, values) {
  let out = message;
  for (const secret of [values["report-token"], values["deploy-private-key"]]) if (secret) out = out.split(secret).join("<geheim>");
  return out;
}
