// CLI argument parsing and project-name validation.
export const DEFAULTS = { owner: "Marcowinni", template: "Marcowinni/project-template" };
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;
const VALUE_FLAGS = { "--owner": "owner", "--template": "template" };
const BOOLEAN_FLAGS = { "--protect": "protect", "--dry-run": "dryRun" };

export const USAGE = "Aufruf: node setup/new-project.mjs <name> [--owner Marcowinni] [--template Marcowinni/project-template] [--protect] [--dry-run]";

export function validateName(name) {
  return typeof name === "string" && NAME_PATTERN.test(name);
}

/** Throws on unknown flags, missing values or an invalid name. */
export function parseArgs(argv) {
  const opts = { ...DEFAULTS, protect: false, dryRun: false, name: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg in VALUE_FLAGS) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`${arg} braucht einen Wert.`);
      opts[VALUE_FLAGS[arg]] = value;
    } else if (arg in BOOLEAN_FLAGS) {
      opts[BOOLEAN_FLAGS[arg]] = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unbekannte Option: ${arg}`);
    } else if (opts.name === null) {
      opts.name = arg;
    } else {
      throw new Error(`Zu viele Argumente: ${arg}`);
    }
  }
  if (opts.name === null) throw new Error("Projektname fehlt.");
  if (!validateName(opts.name)) throw new Error(`Ungültiger Name «${opts.name}»: erlaubt sind a-z, 0-9 und «-» (2-63 Zeichen, nicht mit «-» beginnend).`);
  return opts;
}
