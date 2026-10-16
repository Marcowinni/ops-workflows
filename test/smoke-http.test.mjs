import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChecks, runCheck, runChecks } from "../smoke-http/lib/checks.mjs";

test("parseChecks: url with optional expected text, comments and blanks skipped", () => {
  assert.deepEqual(parseChecks("https://a.ch | Willkommen\n\n# note\nhttps://a.ch/impressum"), [
    { url: "https://a.ch", expect: "Willkommen" },
    { url: "https://a.ch/impressum", expect: null },
  ]);
  assert.deepEqual(parseChecks("https://a.ch | A | B"), [{ url: "https://a.ch", expect: "A | B" }]);
  assert.throws(() => parseChecks("http://a.ch"), /https URL first/);
});

const response = (status, body = "") => ({ ok: status >= 200 && status < 300, status, text: async () => body });

test("runCheck: ok, wrong status, missing text, network error", async () => {
  assert.equal(await runCheck({ url: "https://a.ch", expect: "Hi" }, async () => response(200, "<h1>Hi</h1>")), null);
  assert.equal(await runCheck({ url: "https://a.ch", expect: null }, async () => response(503)), "https://a.ch → HTTP 503");
  assert.equal(await runCheck({ url: "https://a.ch", expect: "Hi" }, async () => response(200, "nope")), "https://a.ch → Text fehlt: «Hi»");
  assert.equal(await runCheck({ url: "https://a.ch", expect: null }, async () => { throw new Error("ECONNRESET"); }), "https://a.ch → ECONNRESET");
});

test("runChecks: only failing checks are retried, last attempt decides", async () => {
  const checks = [{ url: "https://a.ch" }, { url: "https://b.ch" }, { url: "https://c.ch" }];
  const calls = [];
  const sleeps = [];
  const flaky = { "https://b.ch": 1 }; // fails once, then recovers
  const run = async ({ url }) => {
    calls.push(url);
    if (url === "https://c.ch") return `${url} → HTTP 500`;
    if (flaky[url]-- > 0) return `${url} → Timeout`;
    return null;
  };
  const failures = await runChecks(checks, { attempts: 3, delayMs: 60_000, run, sleep: async (ms) => sleeps.push(ms) });
  assert.deepEqual(failures, ["https://c.ch → HTTP 500"]);
  assert.deepEqual(calls, ["https://a.ch", "https://b.ch", "https://c.ch", "https://b.ch", "https://c.ch", "https://c.ch"]);
  assert.deepEqual(sleeps, [60_000, 60_000]);
  assert.deepEqual(await runChecks(checks.slice(0, 1), { run: async () => null, sleep: async () => assert.fail("no retry when green") }), []);
});
