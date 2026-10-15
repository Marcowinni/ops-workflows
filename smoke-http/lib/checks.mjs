// Parse and run HTTP smoke checks: one per line, "URL" or "URL | expected text".
// A start, not a full E2E (ADR 0044): proves the live pages answer and carry
// the content they should — enough to stop auto-merges when prod is broken.

export function parseChecks(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [url, ...rest] = line.split("|");
      const expect = rest.join("|").trim();
      if (!/^https:\/\/\S+$/.test(url.trim())) throw new Error(`invalid check line (https URL first): ${line}`);
      return { url: url.trim(), expect: expect || null };
    });
}

/** Returns null when the check passes, else a one-line reason. */
export async function runCheck({ url, expect }, fetchFn = fetch, timeoutMs = 20_000) {
  let res;
  try {
    res = await fetchFn(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return `${url} → ${e.name === "TimeoutError" ? "Timeout" : e.message}`;
  }
  if (!res.ok) return `${url} → HTTP ${res.status}`;
  if (expect) {
    const body = await res.text();
    if (!body.includes(expect)) return `${url} → Text fehlt: «${expect}»`;
  }
  return null;
}
