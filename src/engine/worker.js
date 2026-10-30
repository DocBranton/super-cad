// Geometry worker: owns the Open CASCADE kernel and the current solids.
// Messages in:  {id, type: "regenerate", plan, rollback} | {id, type: "validate"} | {id, type: "export", format, bodyIds}
// Messages out: {id, ok: true, result} | {id, ok: false, error}
import opencascade from "replicad-opencascadejs";
import wasmUrl from "replicad-opencascadejs/wasm?url";
import * as r from "replicad";
import { parsePlan } from "../../shared/plan-schema.js";
import { regenerate, describe, MATERIALS, loadFonts } from "./regenerate.js";
import sansUrl from "@fontsource/roboto/files/roboto-latin-400-normal.woff?url";
import sansBoldUrl from "@fontsource/roboto/files/roboto-latin-700-normal.woff?url";
import monoUrl from "@fontsource/roboto-mono/files/roboto-mono-latin-700-normal.woff?url";

const FONT_URLS = { sans: sansUrl, "sans-bold": sansBoldUrl, mono: monoUrl };
import { validateBodies } from "./validate.js";

let oc = null;
let fontErrors = {};
let ready = null;
let current = { plan: null, bodies: [], features: {} };
let importedShape = null;

function init() {
  ready ??= opencascade({ locateFile: () => wasmUrl }).then((instance) => {
    oc = instance;
    r.setOC(oc);
    return loadFonts(r, async (key) => {
      const res = await fetch(FONT_URLS[key]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    }).then((errors) => {
      fontErrors = errors;
    });
  });
  return ready;
}

function release() {
  for (const b of current.bodies) b.shape?.delete?.();
  current = { plan: null, bodies: [], features: {} };
}

const handlers = {
  async importStep({ buffer, name }) {
    await init();
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 50 || buffer.byteLength > 32 * 1024 * 1024) throw new Error("STEP file must be between 50 bytes and 32 MB");
    const shape = await r.importSTEP(new Blob([buffer], { type: "application/step" }));
    if (!shape || !shape.solids?.length) { shape?.delete?.(); throw new Error("STEP contains no solid B-Rep geometry"); }
    let detail;
    try { detail = describe(r, { id: "imported", name: String(name || "Imported STEP").slice(0, 100), shape }, undefined); }
    catch (e) { shape.delete?.(); throw e; }
    importedShape?.delete?.();
    importedShape = shape;
    const transfer = [detail.vertices.buffer, detail.normals.buffer, detail.triangles.buffer, detail.lines.buffer];
    return { result: { ...detail, solidCount: shape.solids.length }, transfer };
  },
  async exportImportedStep() {
    await init();
    if (!importedShape) throw new Error("Import a STEP solid first");
    const blob = r.exportSTEP([{ shape: importedShape, name: "Imported model" }], { unit: "mm" });
    const buffer = await blob.arrayBuffer();
    return { result: { buffer, bytes: buffer.byteLength }, transfer: [buffer] };
  },
  async init() {
    const t0 = performance.now();
    await init();
    return { ms: Math.round(performance.now() - t0), materials: Object.keys(MATERIALS), fontErrors };
  },
  async regenerate({ plan: raw, rollback }) {
    await init();
    const plan = parsePlan(raw);
    const out = regenerate(r, plan, { rollback });
    release();
    current = { plan, bodies: out.bodies, features: out.features };
    const transfer = [];
    const bodies = out.bodies.map((b) => {
      const def = plan.bodies.find((x) => x.id === b.id);
      try {
        const d = describe(r, b, def.material);
        if (!d.empty) transfer.push(d.vertices.buffer, d.normals.buffer, d.triangles.buffer, d.lines.buffer);
        return { ...d, color: def.color, material: def.material, visible: def.visible, failed: b.failed };
      } catch (e) {
        return { id: b.id, name: b.name, empty: true, failed: true, error: "could not mesh this body" };
      }
    });
    return { result: { bodies, features: out.features, parameters: out.parameters, parameterErrors: out.parameterErrors, ms: out.ms }, transfer };
  },
  async validate() {
    await init();
    if (!current.plan) throw new Error("nothing to validate yet");
    return validateBodies(r, oc, current.plan, current.bodies, current.features);
  },
  async export({ format, bodyIds }) {
    await init();
    const chosen = current.bodies.filter((b) => b.shape && (!bodyIds || bodyIds.includes(b.id)));
    if (!chosen.length) throw new Error("no solid geometry to export");
    let blob;
    if (format === "step") {
      blob = r.exportSTEP(
        chosen.map((b) => ({ shape: b.shape, name: b.name, color: current.plan.bodies.find((x) => x.id === b.id)?.color })),
        { unit: "mm" },
      );
    } else if (format === "stl") {
      const shape = chosen.length === 1 ? chosen[0].shape : r.makeCompound(chosen.map((b) => b.shape));
      blob = shape.blobSTL({ binary: true, tolerance: 0.02, angularTolerance: 10 });
    } else throw new Error(`unknown export format ${format}`);
    const buffer = await blob.arrayBuffer();
    return { result: { buffer, bytes: buffer.byteLength }, transfer: [buffer] };
  },
};

self.onmessage = async ({ data }) => {
  const { id, type, ...args } = data;
  try {
    const out = await handlers[type](args);
    const result = out && "result" in out && "transfer" in out ? out.result : out;
    self.postMessage({ id, ok: true, result }, out?.transfer ?? []);
  } catch (e) {
    self.postMessage({ id, ok: false, error: e?.message || "geometry kernel error" });
  }
};
