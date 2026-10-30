// Auth behaviour against a fake Databricks: reproduces the "403 Invalid scope" seen when a
// user's token was issued before the app's model-serving scope existed.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { BRACKET } from "../shared/samples.js";

process.env.DATABRICKS_HOST = "example.cloud.databricks.com";
process.env.DATABRICKS_CLIENT_ID = "app-id";
process.env.DATABRICKS_CLIENT_SECRET = "app-secret";
process.env.SERVING_ENDPOINT = "databricks-llama-4-maverick";

const { api } = await import("../server/databricks.js");
const { plan } = await import("../server/planner.js");

let calls;
const reply = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const auth = init.headers?.authorization ?? "";
    calls.push({ url: String(url), auth });
    if (String(url).endsWith("/oidc/v1/token")) return reply(200, { access_token: "app-token", expires_in: 3600 });
    if (auth === "Bearer user-token-no-scope") return reply(403, "Invalid scope, required scopes: model-serving, model-serving-inference");
    if (auth === "Bearer user-token-forbidden") return reply(403, "User does not have permission to read this volume");
    if (String(url).includes("/invocations")) return reply(200, { choices: [{ message: { content: JSON.stringify(BRACKET) } }] });
    return reply(200, { ok: true });
  };
});

const req = (token) => ({ get: (h) => (h === "x-forwarded-access-token" ? token : h === "x-forwarded-email" ? "airman@example.mil" : undefined) });

test("planner calls the endpoint as the app, never with the user's token", async () => {
  const out = await plan(req("user-token-no-scope"), { prompt: "a bracket" });
  assert.equal(out.plan.name, BRACKET.name);
  const inv = calls.filter((c) => c.url.includes("/invocations"));
  assert.equal(inv.length, 1);
  assert.equal(inv[0].auth, "Bearer app-token");
});

test("user identity falls back to the app on a scope error", async () => {
  const res = await api(req("user-token-no-scope"), "/api/2.0/fs/files/Volumes/x");
  assert.equal(res.status, 200);
  assert.deepEqual(calls.filter((c) => !c.url.endsWith("/token")).map((c) => c.auth), ["Bearer user-token-no-scope", "Bearer app-token"]);
});

test("a real permission denial for the user is not bypassed", async () => {
  await assert.rejects(api(req("user-token-forbidden"), "/api/2.0/fs/files/Volumes/x"), /403/);
  assert.ok(!calls.some((c) => c.auth === "Bearer app-token"));
});
