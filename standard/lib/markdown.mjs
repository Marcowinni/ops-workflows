// Small markdown helpers for the content checks (no parser, no dependencies).

const isHeading = (line) => /^\s*#{1,6}\s/.test(line);

/** Non-empty lines that are not headings. */
export function contentLines(text) {
  return (text ?? "").split("\n").filter((l) => l.trim() && !isHeading(l));
}

/** Non-empty content lines directly under the first heading matching `pattern`. */
export function sectionContent(text, pattern) {
  const lines = (text ?? "").split("\n");
  const start = lines.findIndex((l) => isHeading(l) && pattern.test(l));
  if (start < 0) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (isHeading(line)) break;
    if (line.trim()) out.push(line);
  }
  return out;
}
