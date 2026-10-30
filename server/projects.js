// Project storage with revision history and ownership.
// In a Databricks App: a Unity Catalog Volume through the Files API (PROJECTS_VOLUME).
// Locally: ./data (ephemeral in a deployed app, so the UI warns when this backend is active).
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parsePlan } from "../shared/plan-schema.js";
import { api, userOf, isConfigured } from "./databricks.js";

const MAX_REVISIONS = 100;
const ID = /^[a-z0-9-]{6,40}$/;

function volumeRoot() {
  let v = process.env.PROJECTS_VOLUME;
  if (!v) return null;
  if (!v.startsWith("/Volumes/")) v = "/Volumes/" + v.split(".").join("/"); // catalog.schema.volume
  return v.replace(/\/$/, "") + "/si-cad-workbench/projects";
}

export function storageStatus() {
  const root = volumeRoot();
  return root && isConfigured() ? { backend: "volume", location: root } : { backend: "local", location: "./data (not durable in a deployed app)" };
}

const local = {
  dir: path.resolve("data/projects"),
  async read(req, id) {
    try {
      return JSON.parse(await fs.readFile(path.join(this.dir, `${id}.json`), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  },
  async write(req, id, doc) {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(path.join(this.dir, `${id}.json`), JSON.stringify(doc));
  },
  async list() {
    try {
      const names = await fs.readdir(this.dir);
      return names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5));
    } catch {
      return [];
    }
  },
};

const volume = {
  async read(req, id) {
    try {
      const res = await api(req, `/api/2.0/fs/files${volumeRoot()}/${id}.json`);
      return await res.json();
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  },
  async write(req, id, doc) {
    await api(req, `/api/2.0/fs/files${volumeRoot()}/${id}.json?overwrite=true`, {
      method: "PUT",
      raw: true,
      body: JSON.stringify(doc),
      headers: { "content-type": "application/octet-stream" },
    });
  },
  async list(req) {
    try {
      const res = await api(req, `/api/2.0/fs/directories${volumeRoot()}`);
      const j = await res.json();
      return (j.contents ?? []).filter((c) => !c.is_directory && c.name.endsWith(".json")).map((c) => c.name.slice(0, -5));
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
  },
};

const store = () => (storageStatus().backend === "volume" ? volume : local);

function canRead(doc, user) {
  return doc.owner === user || (doc.sharedWith ?? []).includes(user);
}

function summary(doc) {
  const last = doc.revisions.at(-1);
  return { id: doc.id, name: doc.name, owner: doc.owner, revisions: doc.revisions.length, updatedAt: last?.at, validation: last?.validation?.status ?? "unverified" };
}

export async function listProjects(req) {
  const user = userOf(req);
  const ids = await store().list(req);
  const docs = await Promise.all(ids.slice(0, 200).map((id) => store().read(req, id).catch(() => null)));
  return docs.filter((d) => d && canRead(d, user)).map(summary).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getProject(req, id) {
  if (!ID.test(id)) throw Object.assign(new Error("bad project id"), { status: 400 });
  const doc = await store().read(req, id);
  if (!doc || !canRead(doc, userOf(req))) throw Object.assign(new Error("project not found"), { status: 404 });
  return doc;
}

/** Commit a new revision. Creates the project when `id` is absent. */
export async function commitRevision(req, { id, plan, message, validation, planHash }) {
  const user = userOf(req);
  const parsed = parsePlan(plan);
  let doc;
  if (id) {
    doc = await getProject(req, id);
    if (doc.owner !== user) throw Object.assign(new Error("only the owner can commit revisions"), { status: 403 });
  } else {
    doc = { id: crypto.randomUUID().slice(0, 18), owner: user, createdAt: new Date().toISOString(), sharedWith: [], revisions: [] };
  }
  doc.name = parsed.name;
  doc.revisions.push({
    rev: (doc.revisions.at(-1)?.rev ?? 0) + 1,
    at: new Date().toISOString(),
    by: user,
    message: String(message ?? "").slice(0, 200) || "Saved",
    planHash: typeof planHash === "string" ? planHash.slice(0, 64) : undefined,
    validation: validation && typeof validation === "object" ? { status: validation.status === "validated" ? "validated" : "failed", at: validation.at, checks: (validation.checks ?? []).slice(0, 60) } : { status: "unverified" },
    plan: parsed,
  });
  if (doc.revisions.length > MAX_REVISIONS) doc.revisions = doc.revisions.slice(-MAX_REVISIONS);
  await store().write(req, doc.id, doc);
  return summary(doc);
}
