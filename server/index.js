// SI CAD Workbench — Databricks App server.
// Serves the built client, the SI planning endpoint and project storage. Geometry runs in the
// user's browser (Open CASCADE compiled to WebAssembly), so this server does no CAD work.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { plan, siStatus } from "./planner.js";
import { listProjects, getProject, commitRevision, storageStatus } from "./projects.js";
import { userOf } from "./databricks.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

// Security headers. The page itself may compile WebAssembly but never evaluate strings.
// The geometry worker is the one exception: Emscripten's generated bindings (embind) build
// functions at runtime, so worker scripts get 'unsafe-eval'. A worker has no DOM, no cookies
// and no access to the page, and it may only talk to this origin.
const PAGE_CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";
const WORKER_CSP = "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'self'";
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy": /^\/assets\/worker-[\w-]+\.js$/.test(req.path) ? WORKER_CSP : PAGE_CSP,
  });
  next();
});

const audit = (req, event, detail = {}) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), event, user: userOf(req), ...detail }));

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    audit(req, "error", { path: req.path, status, message: e.message });
    res.status(status).json({ error: e.message });
  }
};

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get(
  "/api/config",
  wrap(async (req) => ({
    version: pkg.version,
    user: userOf(req),
    si: siStatus(),
    storage: storageStatus(),
    theme: process.env.SERVICE_THEME || "air-force",
    classification: process.env.CLASSIFICATION_BANNER || "",
  })),
);

app.post(
  "/api/si/plan",
  wrap(async (req) => {
    const out = await plan(req, req.body ?? {});
    audit(req, "si.plan", { planner: out.planner, ms: out.ms, promptChars: String(req.body?.prompt ?? "").length, bodies: out.plan.bodies.length });
    return out;
  }),
);

// Browser-side errors (render crashes, unhandled rejections, lost WebGL context) land in the
// app log next to server events, so a blank screen on someone's phone can be diagnosed.
app.post("/api/client-error", express.json({ limit: "16kb" }), (req, res) => {
  const b = req.body ?? {};
  const clip = (v, n) => String(v ?? "").slice(0, n);
  audit(req, "client.error", {
    kind: clip(b.kind, 40),
    message: clip(b.message, 500),
    stack: clip(b.stack, 2000),
    componentStack: clip(b.componentStack, 1500),
    plan: clip(b.plan, 80),
    editing: clip(b.editing, 40),
    viewport: clip(b.viewport, 40),
    userAgent: clip(req.get("user-agent"), 200),
  });
  res.status(204).end();
});

app.get("/api/projects", wrap((req) => listProjects(req)));
app.get("/api/projects/:id", wrap((req) => getProject(req, req.params.id)));
app.post(
  "/api/projects",
  wrap(async (req) => {
    const out = await commitRevision(req, req.body ?? {});
    audit(req, "project.commit", { id: out.id, revisions: out.revisions, validation: out.validation });
    return out;
  }),
);

// Static client (built by `npm run build`). WASM and hashed assets are immutable.
const dist = path.join(root, "dist");
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".json": "application/json" };
if (existsSync(dist)) {
  // Serve pre-compressed assets (scripts/precompress.js) when the browser accepts them.
  app.use("/assets", (req, res, next) => {
    const accept = req.get("accept-encoding") || "";
    const file = path.join(dist, "assets", path.basename(req.path));
    const type = TYPES[path.extname(file)];
    for (const [enc, ext] of [["br", ".br"], ["gzip", ".gz"]]) {
      if (type && accept.includes(enc) && existsSync(file + ext)) {
        res.set({ "Content-Encoding": enc, "Content-Type": type, Vary: "Accept-Encoding", "Cache-Control": "public, max-age=31536000, immutable" });
        return res.sendFile(file + ext);
      }
    }
    next();
  });
  app.use(
    express.static(dist, {
      index: false,
      setHeaders(res, file) {
        if (file.includes(`${path.sep}assets${path.sep}`)) res.set("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, "index.html")));
} else {
  app.get("/", (req, res) => res.type("text").send("Client not built. Run `npm run build`, or `npm run dev` for development."));
}

const port = Number(process.env.DATABRICKS_APP_PORT || process.env.PORT || 8000);
const server = app.listen(port, "0.0.0.0", () => console.log(`SI CAD Workbench ${pkg.version} on :${port} — storage ${storageStatus().backend}, SI ${siStatus().configured ? siStatus().endpoint : `offline planner (${siStatus().reason})`}`));
// Databricks Apps give 15 s after SIGTERM.
process.on("SIGTERM", () => server.close(() => process.exit(0)));
