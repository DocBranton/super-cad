// Minimal Databricks REST client for a Databricks App.
// Prefers the signed-in user's token (on-behalf-of, `x-forwarded-access-token`), and falls back
// to the app's service principal (OAuth M2M with DATABRICKS_CLIENT_ID / DATABRICKS_CLIENT_SECRET).

const host = () => {
  const h = process.env.DATABRICKS_HOST;
  if (!h) return null;
  return (h.startsWith("http") ? h : `https://${h}`).replace(/\/$/, "");
};

let spToken = null; // { value, expires }

async function servicePrincipalToken() {
  const id = process.env.DATABRICKS_CLIENT_ID;
  const secret = process.env.DATABRICKS_CLIENT_SECRET;
  if (!id || !secret || !host()) return process.env.DATABRICKS_TOKEN || null; // local dev
  if (spToken && spToken.expires > Date.now() + 60_000) return spToken.value;
  const res = await fetch(`${host()}/oidc/v1/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64") },
    body: "grant_type=client_credentials&scope=all-apis",
  });
  if (!res.ok) throw new Error(`service principal sign-in failed (${res.status})`);
  const j = await res.json();
  spToken = { value: j.access_token, expires: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return spToken.value;
}

/** Token for a request: the user's when present, otherwise the app's. */
export async function tokenFor(req) {
  return req.get("x-forwarded-access-token") || (await servicePrincipalToken());
}

export function isConfigured() {
  return Boolean(host());
}

export function userOf(req) {
  return req.get("x-forwarded-email") || req.get("x-forwarded-preferred-username") || req.get("x-forwarded-user") || "local-user";
}

/**
 * Call a Databricks REST API.
 * identity "user" (default) uses the signed-in user's token and, if that token lacks the scope
 * (403 "Invalid scope") or is absent, retries once as the app's service principal.
 * identity "app" uses the service principal directly — right for resources bound to the app,
 * such as the serving endpoint, whose permission is granted to the app, not to each user.
 */
export async function api(req, path, { method = "GET", body, raw = false, headers = {}, identity = "user" } = {}) {
  if (!host()) throw Object.assign(new Error("DATABRICKS_HOST is not set"), { status: 503 });
  const userToken = identity === "user" ? req.get("x-forwarded-access-token") : null;
  const send = (token) =>
    fetch(host() + path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined && !raw ? { "content-type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
  let res = null;
  let detail = "";
  if (userToken) {
    res = await send(userToken);
    if (!res.ok) detail = await res.text().catch(() => "");
    const scopeProblem = res.status === 401 || (res.status === 403 && /scope/i.test(detail));
    if (res.ok || !scopeProblem) return finish(res, detail, method, path);
  }
  const appToken = await servicePrincipalToken();
  if (!appToken) {
    if (res) return finish(res, detail, method, path);
    throw Object.assign(new Error("no Databricks credentials available"), { status: 503 });
  }
  res = await send(appToken);
  return finish(res, res.ok ? "" : await res.text().catch(() => ""), method, path);
}

function finish(res, detail, method, path) {
  if (res.ok) return res;
  throw Object.assign(new Error(`Databricks ${method} ${path.split("?")[0]} → ${res.status} ${detail.slice(0, 300)}`), { status: res.status });
}
