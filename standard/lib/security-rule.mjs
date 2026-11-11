// Rule: Teil 1 of docs/SECURITY.md must equal the central standard (ADR 0052 Q44).
import { finding } from "./finding.mjs";

const START = "<!-- standard:start -->";
const END = "<!-- standard:end -->";
const FILE = "docs/SECURITY.md";

const normalise = (s) => s.replace(/\r\n/g, "\n").trimEnd();

function extractBlock(text) {
  const start = text.indexOf(START);
  const end = text.indexOf(END, start + START.length);
  if (start === -1 || end === -1) return null;
  return text.slice(start, end + END.length);
}

/** central: text of standard/security-standard.md (injected); null skips the rule. */
export function checkSecurityStandard({ stufe, ctx, central }) {
  if (stufe < 2 || central == null) return [];
  const doc = ctx.read(FILE);
  if (doc === null) return [];
  const block = extractBlock(normalise(doc));
  if (block === null) return [finding("security-standard", "SECURITY.md Teil 1: Markierungen fehlen (standard:start / standard:end).", FILE)];
  const expected = extractBlock(normalise(central)) ?? normalise(central);
  if (block !== expected) return [finding("security-standard", "SECURITY.md Teil 1 weicht von der zentralen Version ab.", FILE)];
  return [];
}
