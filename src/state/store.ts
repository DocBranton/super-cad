// Application state: the plan (system of record), undo history, regeneration results,
// validation and UI state. One small store with useSyncExternalStore; no framework.
import { useRef, useSyncExternalStore } from "react";
import { geometry, type RegenResult, type ValidationReport } from "../engine/client";
import { BRACKET } from "../../shared/samples.js";
import { parsePlan } from "../../shared/plan-schema.js";
import { planHash } from "../engine/validate.js";

export type Value = number | string;
export type Feature = { id: string; op: "extrude" | "hole" | "fillet" | "chamfer" | "shell"; name?: string; suppressed?: boolean; [k: string]: any };
export type Body = { id: string; name: string; material?: string; color?: string; placement: Value[]; visible: boolean; features: Feature[] };
export type Parameter = { name: string; expr: Value; unit: string; description?: string };
export type Plan = { schema: string; name: string; units: "mm"; parameters: Parameter[]; bodies: Body[]; assumptions: string[] };

export type Selection = { kind: "body"; id: string } | { kind: "feature"; id: string } | { kind: "parameter"; name: string } | null;
export type Dialog = null | "parameters" | "projects" | "validation" | "about" | "properties";
export type DisplayMode = "shaded-edges" | "shaded" | "wireframe";

export type Config = {
  version: string;
  user: string;
  si: { configured: boolean; endpoint: string | null; reason?: string | null };
  storage: { backend: "volume" | "local"; location: string };
  theme: string;
  classification: string;
};

export type ChatEntry = { id: number; role: "user" | "assistant"; text: string; plan?: Plan; planner?: string; status?: "pending" | "proposed" | "applied" | "discarded" | "error" };

export type State = {
  plan: Plan;
  past: Plan[];
  future: Plan[];
  rollback: number | null;
  regen: RegenResult | null;
  regenerating: boolean;
  kernelReady: boolean;
  kernelError: string | null;
  validation: (ValidationReport & { forHash: string }) | null;
  validating: boolean;
  currentHash: string;
  selection: Selection;
  editing: string | null; // feature id open in the feature dialog
  editSnapshot: Plan | null;
  dialog: Dialog;
  assistantOpen: boolean;
  browserOpen: boolean;
  ribbonTab: string;
  display: DisplayMode;
  ortho: boolean;
  grid: boolean;
  status: string;
  project: { id: string | null; rev: number; savedHash: string | null };
  config: Config | null;
  chat: ChatEntry[];
  showHome: boolean;
  viewRequest: { name: string; n: number } | null;
};

const initialPlan = parsePlan(structuredClone(BRACKET)) as Plan;

let state: State = {
  plan: initialPlan,
  past: [],
  future: [],
  rollback: null,
  regen: null,
  regenerating: false,
  kernelReady: false,
  kernelError: null,
  validation: null,
  validating: false,
  currentHash: "",
  selection: null,
  editing: null,
  editSnapshot: null,
  dialog: null,
  // On phones and narrow windows the side panels overlay the viewport, so start with them closed.
  assistantOpen: typeof window === "undefined" || window.innerWidth > 760,
  browserOpen: typeof window === "undefined" || window.innerWidth > 760,
  ribbonTab: "SOLID",
  display: "shaded-edges",
  ortho: false,
  grid: true,
  status: "Loading geometry kernel…",
  project: { id: null, rev: 0, savedHash: null },
  config: null,
  chat: [],
  showHome: false,
  viewRequest: null,
};

const listeners = new Set<() => void>();
export const getState = () => state;
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** True when two values are identical or are arrays/plain objects with identical members. */
function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => Object.is((a as any)[k], (b as any)[k]));
}

/**
 * Subscribe a component to part of the state. A selector may build a new array or object
 * (e.g. filter or `?? {}`); the hook returns the previous result while it is shallow-equal, so
 * React never sees a "changed" snapshot on every read — which would loop until React aborts
 * (error #185) and the page goes blank.
 */
export function useStore<T>(select: (s: State) => T): T {
  const last = useRef<{ value: T } | null>(null);
  const getSnapshot = () => {
    const value = select(state);
    if (last.current && shallowEqual(last.current.value, value)) return last.current.value;
    last.current = { value };
    return value;
  };
  return useSyncExternalStore(subscribe, getSnapshot);
}

// ---------------------------------------------------------------------------------------------
// Regeneration (debounced, latest-wins)

let regenTimer: ReturnType<typeof setTimeout> | null = null;
let regenSeq = 0;

export function scheduleRegen(delay = 120) {
  if (regenTimer) clearTimeout(regenTimer);
  regenTimer = setTimeout(runRegen, delay);
}

async function runRegen() {
  const mySeq = ++regenSeq;
  const { plan, rollback } = state;
  setState({ regenerating: true });
  const hash = await planHash(plan);
  try {
    const result = await geometry.regenerate(plan, rollback ?? undefined);
    if (mySeq !== regenSeq) return;
    const errors = Object.values(result.features).filter((f) => f.state === "error").length;
    setState({
      regen: result,
      regenerating: false,
      kernelReady: true,
      currentHash: hash,
      status: errors ? `Regenerated with ${errors} error${errors > 1 ? "s" : ""}` : `Regenerated in ${result.ms} ms`,
    });
  } catch (e: any) {
    if (mySeq !== regenSeq) return;
    setState({ regenerating: false, currentHash: hash, status: `Regeneration failed: ${e.message}` });
  }
}

// ---------------------------------------------------------------------------------------------
// Plan edits. Every edit goes through commit() so undo, validation reset and regen are uniform.

const clone = <T,>(x: T): T => structuredClone(x);

/** Apply a mutation to a copy of the plan, push history, invalidate validation and regenerate. */
export function commit(mutate: (p: Plan) => void, status?: string, { history = true } = {}) {
  const next = clone(state.plan);
  mutate(next);
  setState((s) => ({
    plan: next,
    past: history ? [...s.past.slice(-99), s.plan] : s.past,
    future: history ? [] : s.future,
    status: status ?? s.status,
  }));
  scheduleRegen();
}

export function replacePlan(plan: Plan, status: string) {
  setState((s) => ({ plan: clone(plan), past: [...s.past.slice(-99), s.plan], future: [], rollback: null, selection: null, editing: null, status }));
  scheduleRegen(0);
  requestView("fit");
}

export function undo() {
  const { past, plan, future } = state;
  if (!past.length) return;
  setState({ plan: past[past.length - 1], past: past.slice(0, -1), future: [plan, ...future], status: "Undo", editing: null });
  scheduleRegen(0);
}

export function redo() {
  const { past, plan, future } = state;
  if (!future.length) return;
  setState({ plan: future[0], past: [...past, plan], future: future.slice(1), status: "Redo", editing: null });
  scheduleRegen(0);
}

export function requestView(name: string) {
  setState((s) => ({ viewRequest: { name, n: (s.viewRequest?.n ?? 0) + 1 } }));
}

export function findFeature(plan: Plan, id: string): { body: Body; feature: Feature; index: number } | null {
  for (const body of plan.bodies) {
    const index = body.features.findIndex((f) => f.id === id);
    if (index >= 0) return { body, feature: body.features[index], index };
  }
  return null;
}

export function timelineOf(plan: Plan) {
  return plan.bodies.flatMap((body) => body.features.map((feature) => ({ body, feature })));
}

export function uniqueId(plan: Plan, base: string) {
  const used = new Set(plan.bodies.flatMap((b) => [b.id, ...b.features.map((f) => f.id)]));
  let i = 1;
  while (used.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

const DEFAULTS: Record<Feature["op"], () => Partial<Feature>> = {
  extrude: () => ({ profile: { type: "rect", width: 20, height: 20 }, plane: "XY", at: [0, 0], offset: 0, distance: 10, mode: "join" }),
  hole: () => ({ face: "top", diameter: 5, positions: [[0, 0]] }),
  fillet: () => ({ radius: 2, edges: "vertical" }),
  chamfer: () => ({ distance: 1, edges: "top" }),
  shell: () => ({ thickness: 2, openFace: "top" }),
};

const NAMES: Record<Feature["op"], string> = { extrude: "Extrude", hole: "Hole", fillet: "Fillet", chamfer: "Chamfer", shell: "Shell" };

/** Insert a new feature after the selected feature (or at the end of the selected/first body) and open it. */
export function addFeature(op: Feature["op"], args: Record<string, unknown> = {}) {
  const { plan, selection } = state;
  let bodyId = plan.bodies[0]?.id;
  let at = -1;
  if (selection?.kind === "feature") {
    const hit = findFeature(plan, selection.id);
    if (hit) {
      bodyId = hit.body.id;
      at = hit.index + 1;
    }
  } else if (selection?.kind === "body") bodyId = selection.id;
  const id = uniqueId(plan, op);
  const count = timelineOf(plan).filter((t) => t.feature.op === op).length + 1;
  const feature = { id, name: `${NAMES[op]} ${count}`, op, ...DEFAULTS[op](), ...args } as Feature;
  const snapshot = plan;
  commit((p) => {
    const body = p.bodies.find((b) => b.id === bodyId)!;
    body.features.splice(at < 0 ? body.features.length : at, 0, feature);
  }, `${NAMES[op]} added`);
  setState({ selection: { kind: "feature", id }, editing: id, editSnapshot: snapshot, rollback: null });
}

export function addBody() {
  const { plan } = state;
  const id = uniqueId(plan, "body");
  const n = plan.bodies.length + 1;
  const featureId = uniqueId(plan, "extrude");
  const snapshot = plan;
  commit((p) => {
    p.bodies.push({
      id,
      name: `Body ${n}`,
      material: "Aluminum 6061",
      color: ["#c9ced6", "#e8833a", "#7fa7d9", "#9ccc65", "#d4a95a"][n % 5],
      placement: [0, 0, 0],
      visible: true,
      features: [{ id: featureId, name: "Base", op: "extrude", profile: { type: "rect", width: 30, height: 30 }, plane: "XY", at: [0, 0], offset: 0, distance: 15, mode: "new" }],
    });
  }, "New body");
  setState({ selection: { kind: "feature", id: featureId }, editing: featureId, editSnapshot: snapshot });
}

export function deleteFeature(id: string) {
  const hit = findFeature(state.plan, id);
  if (!hit) return;
  if (hit.body.features.length === 1) {
    if (state.plan.bodies.length === 1) return setState({ status: "A design needs at least one feature" });
    commit((p) => (p.bodies = p.bodies.filter((b) => b.id !== hit.body.id)), `Deleted body ${hit.body.name}`);
  } else commit((p) => findFeature(p, id)!.body.features.splice(hit.index, 1), `Deleted ${hit.feature.name ?? id}`);
  setState({ selection: null, editing: null });
}

export function setParameter(name: string, expr: Value) {
  const exists = state.plan.parameters.some((p) => p.name === name);
  commit((p) => {
    const param = p.parameters.find((x) => x.name === name);
    if (param) param.expr = expr;
    else p.parameters.push({ name, expr, unit: "mm" });
  }, `${exists ? "Set" : "Added"} ${name} = ${expr}`);
}

// ---------------------------------------------------------------------------------------------
// Validation, export, server calls

export async function runValidation() {
  if (state.regenerating) await new Promise((r) => setTimeout(r, 300));
  setState({ validating: true, dialog: "validation", status: "Running engineering checks…" });
  try {
    const report = await geometry.validate();
    const forHash = await planHash(state.plan);
    const fails = report.checks.filter((c) => c.status === "fail").length;
    setState({ validation: { ...report, forHash }, validating: false, status: fails ? `Validation failed: ${fails} check${fails > 1 ? "s" : ""}` : "All checks passed" });
  } catch (e: any) {
    setState({ validating: false, status: `Validation could not run: ${e.message}` });
  }
}

export function validationState(s: State): "validated" | "failed" | "unverified" | "stale" {
  if (!s.validation) return "unverified";
  if (s.validation.forHash !== s.currentHash) return "stale";
  return s.validation.status;
}

function download(buffer: ArrayBuffer | string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([buffer], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "design";

export async function exportGeometry(format: "step" | "stl") {
  setState({ status: `Exporting ${format.toUpperCase()}…` });
  try {
    const visible = state.plan.bodies.filter((b) => b.visible).map((b) => b.id);
    const { buffer, bytes } = await geometry.export(format, visible);
    download(buffer, `${slug(state.plan.name)}.${format === "step" ? "step" : "stl"}`, format === "step" ? "model/step" : "model/stl");
    const v = validationState(state);
    setState({ status: `Exported ${format.toUpperCase()} (${(bytes / 1024).toFixed(0)} KB)${v === "validated" ? "" : " — not validated"}` });
  } catch (e: any) {
    setState({ status: `Export failed: ${e.message}` });
  }
}

export function exportPlanJson() {
  download(JSON.stringify(state.plan, null, 2), `${slug(state.plan.name)}.si-cad.json`, "application/json");
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `${res.status} ${res.statusText}`);
  return j as T;
}

export async function loadConfig() {
  try {
    const config = await api<Config>("/api/config");
    setState({ config });
    document.documentElement.dataset.theme = config.theme;
  } catch {
    setState({ config: { version: "dev", user: "offline", si: { configured: false, endpoint: null }, storage: { backend: "local", location: "browser only" }, theme: "air-force", classification: "" } });
  }
}

export async function saveProject(message = "Saved") {
  setState({ status: "Saving…" });
  try {
    const v = state.validation && state.validation.forHash === state.currentHash ? state.validation : undefined;
    const out = await api<{ id: string; revisions: number }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ id: state.project.id ?? undefined, plan: state.plan, message, validation: v, planHash: state.currentHash }),
    });
    setState({ project: { id: out.id, rev: out.revisions, savedHash: state.currentHash }, status: `Saved revision ${out.revisions}${v?.status === "validated" ? " (validated)" : " (unverified)"}` });
  } catch (e: any) {
    setState({ status: `Save failed: ${e.message}` });
  }
}

export async function openProject(id: string) {
  setState({ status: "Opening…" });
  try {
    const doc = await api<any>(`/api/projects/${id}`);
    const last = doc.revisions.at(-1);
    replacePlan(parsePlan(last.plan) as Plan, `Opened ${doc.name}, revision ${last.rev}`);
    setState({ project: { id: doc.id, rev: last.rev, savedHash: null }, validation: null, dialog: null, showHome: false, past: [], future: [] });
  } catch (e: any) {
    setState({ status: `Open failed: ${e.message}` });
  }
}

export async function listProjects() {
  return api<Array<{ id: string; name: string; owner: string; revisions: number; updatedAt: string; validation: string }>>("/api/projects");
}

let chatSeq = 0;

export async function askAssistant(prompt: string, modify: boolean) {
  const id = ++chatSeq;
  setState((s) => ({
    chat: [...s.chat, { id: ++chatSeq, role: "user", text: prompt }, { id, role: "assistant", text: "Planning…", status: "pending" }],
    assistantOpen: true,
    status: "SI planner working…",
  }));
  const update = (patch: Partial<ChatEntry>) => setState((s) => ({ chat: s.chat.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  try {
    const out = await api<{ plan: Plan; planner: string; ms: number }>("/api/si/plan", {
      method: "POST",
      body: JSON.stringify({ prompt, current: modify ? state.plan : undefined }),
    });
    const features = out.plan.bodies.reduce((n, b) => n + b.features.length, 0);
    update({
      status: "proposed",
      plan: out.plan,
      planner: out.planner,
      text: `Proposed "${out.plan.name}": ${out.plan.bodies.length} bod${out.plan.bodies.length === 1 ? "y" : "ies"}, ${features} features, ${out.plan.parameters.length} parameters. Review the assumptions, then approve to build it.`,
    });
    setState({ status: `Plan proposed by ${out.planner}` });
  } catch (e: any) {
    update({ status: "error", text: `The planner could not produce a valid plan: ${e.message}` });
    setState({ status: "SI planning failed" });
  }
}

export function approvePlan(entry: ChatEntry) {
  if (!entry.plan) return;
  replacePlan(entry.plan, `Built "${entry.plan.name}" from the approved SI plan — unverified until checks run`);
  setState((s) => ({ chat: s.chat.map((c) => (c.id === entry.id ? { ...c, status: "applied" } : c)), validation: null, showHome: false }));
}

export function discardPlan(entry: ChatEntry) {
  setState((s) => ({ chat: s.chat.map((c) => (c.id === entry.id ? { ...c, status: "discarded" } : c)) }));
}

export async function startKernel() {
  try {
    const { ms, fontErrors } = await geometry.init();
    const blocked = Object.keys(fontErrors ?? {});
    setState({ kernelReady: true, status: blocked.length ? `Geometry kernel ready; fonts unavailable (${blocked.join(", ")}) — text features disabled` : `Geometry kernel ready (${ms} ms)` });
    if (blocked.length) import("../ui/ErrorBoundary").then(({ reportClientError }) => reportClientError("fonts", new Error(JSON.stringify(fontErrors))));
    scheduleRegen(0);
    requestView("home");
  } catch (e: any) {
    setState({ kernelError: e.message, status: `Geometry kernel failed to load: ${e.message}` });
  }
}
