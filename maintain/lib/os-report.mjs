// Client for the Business OS receiver solution_report (ADR 0044). The repo
// authenticates with its report token; only its sha256 lives in the OS.

export function createReporter({ url, token }) {
  return async function post(payload) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-solution-token": token },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`report → ${res.status}: ${text}`);
    return JSON.parse(text);
  };
}
