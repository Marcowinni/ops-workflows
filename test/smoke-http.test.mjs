import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChecks, runCheck } from "../smoke-http/lib/checks.mjs";

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
