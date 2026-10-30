// Deterministic regeneration of a feature plan on the Open CASCADE kernel (via replicad).
// Runs in a Web Worker in the browser and directly in Node for tests. Plain JS so both can load it.
//
// Contract: regenerate(r, plan, { rollback }) evaluates bodies in order, features in order,
// stops a body at its first failing feature (keeping the last good solid) and reports the
// status of every feature. It never throws for bad input — problems become diagnostics.

import { evaluate, resolveParameters } from "../../shared/expr.js";

export const MATERIALS = {
  "Aluminum 6061": 2.7,
  "Aluminum 7075": 2.81,
  "Steel 1018": 7.87,
  "Stainless 316": 8.0,
  "Titanium Ti-6Al-4V": 4.43,
  PETG: 1.27,
  PLA: 1.24,
  ABS: 1.04,
  "Nylon PA12": 1.01,
};

const FACE = {
  top: { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  bottom: { n: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0] },
  front: { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  back: { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  left: { n: [-1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  right: { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
};

const add = (a, b) => a.map((x, i) => x + b[i]);
const mul = (a, k) => a.map((x) => x * k);

function bounds(shape) {
  const [[x0, y0, z0], [x1, y1, z1]] = shape.boundingBox.bounds;
  return { min: [x0, y0, z0], max: [x1, y1, z1], centre: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], size: [x1 - x0, y1 - y0, z1 - z0] };
}

/** Point on the bounding-box face named `face`. */
function facePoint(b, face) {
  const f = FACE[face];
  return f.n.map((n, i) => (n > 0 ? b.max[i] : n < 0 ? b.min[i] : b.centre[i]));
}

function faceFinder(b, face) {
  const p = facePoint(b, face);
  const plane = face === "top" || face === "bottom" ? "XY" : face === "front" || face === "back" ? "XZ" : "YZ";
  return (f) => f.inPlane(plane, p);
}

function edgeFinder(b, set, num) {
  if (set && typeof set === "object") {
    const d = positive("edge diameter", num(set.diameter));
    return (e) =>
      e.when(({ element }) => {
        if (element.geomType !== "CIRCLE") return false;
        const [[x0, y0, z0], [x1, y1, z1]] = element.boundingBox.bounds;
        return Math.abs(Math.max(x1 - x0, y1 - y0, z1 - z0) - d) < 0.02;
      });
  }
  if (set === "all") return undefined;
  if (set === "vertical") return (e) => e.inDirection("Z");
  return (e) => e.inPlane("XY", [0, 0, set === "top" ? b.max[2] : b.min[2]]);
}

function kernelError(op, e) {
  const raw = e && typeof e.message === "string" && e.message ? e.message : "";
  const hint = {
    fillet: "the radius is probably too large for an edge it touches (on twisted surfaces keep it under about a quarter of the wall thickness)",
    chamfer: "the distance is probably too large for an edge it touches",
    shell: "the wall is probably too thick, or a fillet radius equals the shell thickness",
    hole: "the hole may miss the body or break through a thin wall",
    extrude: "check that the profile is closed and the distance is not zero",
  }[op];
  return `${op} failed in the geometry kernel${raw ? ` (${raw})` : ""}${hint ? ` — ${hint}` : ""}`;
}

function positive(name, v) {
  if (!(v > 0)) throw new Error(`${name} must be greater than 0 (got ${round(v)})`);
  return v;
}

let countOf = () => 1;

function round(v) {
  return Math.round(v * 1000) / 1000;
}

/** Font files bundled with the app (Roboto, SIL OFL 1.1). Loaded once by the worker or tests. */
export const FONT_FILES = {
  sans: "@fontsource/roboto/files/roboto-latin-400-normal.woff",
  "sans-bold": "@fontsource/roboto/files/roboto-latin-700-normal.woff",
  mono: "@fontsource/roboto-mono/files/roboto-mono-latin-700-normal.woff",
};
const loadedFonts = new Set();

/** @param readFont (key, path) => Promise<ArrayBuffer> */
const fontErrors = {};

/**
 * Load the bundled fonts. Never throws: a font that cannot be fetched (some managed networks
 * block font downloads) only disables text features, never the geometry kernel.
 * @returns {Record<string, string>} font key → error message, for fonts that failed
 */
export async function loadFonts(r, readFont) {
  for (const [key, path] of Object.entries(FONT_FILES)) {
    if (loadedFonts.has(key)) continue;
    try {
      const data = await readFont(key, path);
      if (!data || !data.byteLength) throw new Error("empty response");
      await r.loadFont(data, key);
      loadedFonts.add(key);
      delete fontErrors[key];
    } catch (e) {
      fontErrors[key] = e?.message || String(e);
    }
  }
  return { ...fontErrors };
}

function drawProfile(r, p, num) {
  if (p.type === "text") {
    const words = num.textOf(p.text).trim();
    if (!words) throw new Error("text is empty");
    if (words.length > 80) throw new Error("text is longer than 80 characters");
    const size = positive("text size", num(p.size));
    const font = p.font ?? "sans-bold";
    if (!loadedFonts.has(font))
      throw new Error(`font "${font}" could not be loaded${fontErrors[font] ? ` (${fontErrors[font]})` : ""} — the network or browser may block font downloads; other features are unaffected`);
    const d = r.drawText(words, { fontSize: size, fontFamily: font });
    const [[x0, y0], [x1, y1]] = d.boundingBox.bounds;
    return d.translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
  }
  if (p.type === "rect") {
    const w = positive("width", num(p.width));
    const h = positive("height", num(p.height));
    const cr = p.cornerRadius === undefined ? 0 : num(p.cornerRadius);
    if (cr < 0 || cr * 2 >= Math.min(w, h)) throw new Error(`corner radius must be between 0 and ${round(Math.min(w, h) / 2)}`);
    return cr > 0 ? r.drawRoundedRectangle(w, h, cr) : r.drawRectangle(w, h);
  }
  if (p.type === "circle") return r.drawCircle(positive("diameter", num(p.diameter)) / 2);
  if (p.type === "slot") {
    const l = positive("length", num(p.length));
    const w = positive("width", num(p.width));
    if (l <= w) throw new Error("slot length must be greater than its width");
    return r.drawRoundedRectangle(l, w, w / 2 - 1e-4);
  }
  if (p.type === "ring") {
    const o = positive("outer diameter", num(p.outer));
    const i = positive("inner diameter", num(p.inner));
    if (i >= o) throw new Error("ring inner diameter must be smaller than the outer diameter");
    return r.drawCircle(o / 2).cut(r.drawCircle(i / 2));
  }
  throw new Error(`unknown profile ${p.type}`);
}

function holeTool(r, b, f, num) {
  const face = FACE[f.face];
  const d = positive("diameter", num(f.diameter));
  const thick = Math.abs(face.n.reduce((s, n, i) => s + n * b.size[i], 0));
  const depth = f.depth === undefined ? thick + 2 : positive("depth", num(f.depth)) + 1;
  let pts = (f.positions ?? []).map(([u, v]) => [num(u), num(v)]);
  if (f.pattern) {
    const nx = Math.round(num(f.pattern.countX));
    const ny = Math.round(num(f.pattern.countY));
    if (nx < 1 || ny < 1 || nx * ny > 64) throw new Error("pattern counts must be 1–64 holes in total");
    const sx = num(f.pattern.spacingX);
    const sy = num(f.pattern.spacingY);
    const grid = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) grid.push([(i - (nx - 1) / 2) * sx, (j - (ny - 1) / 2) * sy]);
    pts = pts.length ? pts.flatMap(([u, v]) => grid.map(([gu, gv]) => [u + gu, v + gv])) : grid;
  }
  if (f.circular) {
    const n = countOf(f.circular.count);
    const rad = positive("bolt circle diameter", num(f.circular.diameter)) / 2;
    const a0 = f.circular.startAngle === undefined ? 0 : num(f.circular.startAngle);
    const ring = Array.from({ length: n }, (_, k) => {
      const a = ((a0 + (360 * k) / n) * Math.PI) / 180;
      return [rad * Math.cos(a), rad * Math.sin(a)];
    });
    pts = pts.length ? pts.flatMap(([u, v]) => ring.map(([cu, cv]) => [u + cu, v + cv])) : ring;
  }
  if (!pts.length) pts = [[0, 0]];
  if (pts.length > 128) throw new Error("too many holes (128 maximum)");
  const centre = facePoint(b, f.face);
  const into = mul(face.n, -1);
  const tools = [];
  for (const [u, v] of pts) {
    const onFace = add(add(centre, mul(face.u, u)), mul(face.v, v));
    let t = r.makeCylinder(d / 2, depth, add(onFace, mul(face.n, 1)), into);
    if (f.countersink) {
      const cd = num(f.countersink.diameter);
      const ang = num(f.countersink.angle ?? 90);
      if (!(cd > d)) throw new Error("countersink diameter must be larger than the hole");
      if (!(ang > 10 && ang < 170)) throw new Error("countersink angle must be between 10° and 170°");
      const h = (cd - d) / 2 / Math.tan(((ang / 2) * Math.PI) / 180);
      const top = r.makeCylinder(cd / 2, 1, add(onFace, mul(face.n, 1)), into);
      const cone = coneSolid(r, onFace, into, cd / 2, d / 2, h);
      t = t.fuse(top).fuse(cone);
    }
    tools.push(t);
  }
  return { tool: tools.length === 1 ? tools[0] : r.makeCompound(tools), count: pts.length };
}

/** A truncated cone from `origin` along unit `dir`, radius r0 → r1 over `h`, built by lofting two circles. */
function coneSolid(r, origin, dir, r0, r1, h) {
  const plane = (o) => new r.Plane(o, perpendicular(dir), dir);
  const a = r.drawCircle(r0).sketchOnPlane(plane(origin));
  const bSk = r.drawCircle(r1).sketchOnPlane(plane(add(origin, mul(dir, h))));
  return a.loftWith(bSk);
}

function perpendicular(n) {
  return Math.abs(n[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
}

function applyFeature(r, shape, f, num) {
  countOf = (v) => {
    const n = Math.round(num(v));
    if (!(n >= 1 && n <= 72)) throw new Error("count must be between 1 and 72");
    return n;
  };
  switch (f.op) {
    case "extrude": {
      const dist = num(f.distance);
      if (dist === 0) throw new Error("distance must not be 0");
      const [u, v] = f.at.map(num);
      const off = num(f.offset) - (f.symmetric ? Math.abs(dist) / 2 : 0);
      const drawing = drawProfile(r, f.profile, num).translate(u, v);
      const twist = f.twist === undefined ? 0 : num(f.twist);
      if (Math.abs(twist) > 360) throw new Error("twist must be between -360° and 360°");
      const n = r.makePlane(f.plane).zDir;
      const twistOrigin = [n.x * off, n.y * off, n.z * off];
      let solid = drawing
        .sketchOnPlane(f.plane, off)
        .extrude(f.symmetric ? Math.abs(dist) : dist, twist ? { twistAngle: twist, origin: twistOrigin } : undefined);
      let note;
      if (f.circular) {
        const count = countOf(f.circular.count);
        const a0 = f.circular.startAngle === undefined ? 0 : num(f.circular.startAngle);
        if (a0) solid = solid.rotate(a0, [0, 0, 0], [0, 0, 1]);
        // One boolean with a compound of copies is several times faster than fusing copies pairwise.
        if (count > 1) solid = r.makeCompound(Array.from({ length: count }, (_, k) => (k ? solid.clone().rotate((360 * k) / count, [0, 0, 0], [0, 0, 1]) : solid)));
        note = `${count} copies, ${round(360 / count)}° apart`;
      }
      if (!shape) return { shape: solid, note: f.mode === "cut" ? "nothing to cut yet; created a new solid" : note };
      if (f.mode === "cut") return { shape: shape.cut(solid), note };
      const fused = shape.fuse(solid);
      if (fused.solids.length > shape.solids.length && f.mode === "join")
        note = `${note ? note + "; " : ""}does not touch the body, so it adds a separate solid`;
      return { shape: fused, note: f.mode === "new" ? "joined to the body (one solid per body)" : note };
    }
    case "hole": {
      if (!shape) throw new Error("a hole needs an existing solid");
      const { tool, count } = holeTool(r, bounds(shape), f, num);
      return { shape: shape.cut(tool), note: `${count} hole${count === 1 ? "" : "s"}` };
    }
    case "fillet": {
      if (!shape) throw new Error("a fillet needs an existing solid");
      return { shape: shape.fillet(positive("radius", num(f.radius)), edgeFinder(bounds(shape), f.edges, num)) };
    }
    case "chamfer": {
      if (!shape) throw new Error("a chamfer needs an existing solid");
      return { shape: shape.chamfer(positive("distance", num(f.distance)), edgeFinder(bounds(shape), f.edges, num)) };
    }
    case "shell": {
      if (!shape) throw new Error("a shell needs an existing solid");
      const t = positive("thickness", num(f.thickness));
      const b = bounds(shape);
      if (t * 2 >= Math.min(...b.size)) throw new Error(`thickness must be under ${round(Math.min(...b.size) / 2)} mm for this body`);
      return { shape: shape.shell(t, faceFinder(b, f.openFace)) };
    }
    default:
      throw new Error(`unknown operation "${f.op}"`);
  }
}

/** Flatten the timeline: one entry per feature, in evaluation order. */
export function timeline(plan) {
  return plan.bodies.flatMap((body) => body.features.map((f) => ({ bodyId: body.id, feature: f })));
}

/**
 * @param r replicad module (already initialised with setOC)
 * @param plan a parsed plan (shared/plan-schema.js parsePlan)
 * @param opts.rollback evaluate only the first N timeline entries (default: all)
 */
export function regenerate(r, plan, opts = {}) {
  const started = Date.now();
  const { values, errors: paramErrors } = resolveParameters(plan.parameters);
  const lookup = (name) => {
    if (name in values) return values[name];
    if (name in paramErrors) throw new Error(`parameter "${name}" is invalid: ${paramErrors[name]}`);
    throw new Error(`unknown parameter "${name}"`);
  };
  const num = (v) => evaluate(v, lookup);
  // Text profiles name a "text" parameter or carry the words literally.
  num.textOf = (raw) => {
    const tp = plan.parameters.find((p) => p.unit === "text" && p.name === raw);
    return tp ? String(tp.expr) : String(raw);
  };
  const limit = opts.rollback ?? Infinity;
  let index = 0;
  const bodies = [];
  const features = {};
  for (const body of plan.bodies) {
    let shape = null;
    let failed = false;
    for (const f of body.features) {
      const pos = index++;
      if (pos >= limit) {
        features[f.id] = { state: "rolled-back" };
        continue;
      }
      if (f.suppressed) {
        features[f.id] = { state: "suppressed" };
        continue;
      }
      if (failed) {
        features[f.id] = { state: "skipped", message: "an earlier feature in this body failed" };
        continue;
      }
      const t0 = Date.now();
      try {
        const out = applyFeature(r, shape, f, num);
        if (shape && out.shape !== shape) shape.delete?.();
        shape = out.shape;
        features[f.id] = { state: "ok", ms: Date.now() - t0, note: out.note };
      } catch (e) {
        failed = true;
        const isKernel = !(e instanceof Error) || e.constructor?.name === "Exception" || !e.message;
        features[f.id] = { state: "error", ms: Date.now() - t0, message: isKernel ? kernelError(f.op, e) : e.message };
      }
    }
    if (shape) {
      const [px, py, pz] = body.placement.map(num);
      if (px || py || pz) {
        const moved = shape.translate([px, py, pz]);
        if (moved !== shape) shape.delete?.();
        shape = moved;
      }
    }
    bodies.push({ id: body.id, name: body.name, shape, failed });
  }
  return { bodies, features, parameters: values, parameterErrors: paramErrors, ms: Date.now() - started };
}

/** Density for a material name, tolerating generic names a planner may use ("Aluminium", "steel"). */
export function densityOf(material) {
  if (!material) return undefined;
  if (MATERIALS[material]) return MATERIALS[material];
  const m = String(material).toLowerCase();
  const alias = [[/alumin/, "Aluminum 6061"], [/stainless/, "Stainless 316"], [/steel/, "Steel 1018"], [/titan/, "Titanium Ti-6Al-4V"], [/petg/, "PETG"], [/\bpla\b/, "PLA"], [/\babs\b/, "ABS"], [/nylon|pa12/, "Nylon PA12"]].find(([re]) => re.test(m));
  return alias ? MATERIALS[alias[1]] : undefined;
}

/** Triangles + edges for three.js, plus measured properties. */
export function describe(r, body, material) {
  const shape = body.shape;
  if (!shape) return { id: body.id, name: body.name, empty: true };
  const mesh = shape.mesh({ tolerance: 0.05, angularTolerance: 15 });
  const edges = shape.meshEdges({ tolerance: 0.05, angularTolerance: 15 });
  const volume = r.measureVolume(shape);
  const area = r.measureArea(shape);
  const b = bounds(shape);
  const density = densityOf(material);
  return {
    id: body.id,
    name: body.name,
    vertices: new Float32Array(mesh.vertices),
    normals: new Float32Array(mesh.normals),
    triangles: new Uint32Array(mesh.triangles),
    lines: new Float32Array(edges.lines),
    faceGroups: mesh.faceGroups,
    volume,
    area,
    bounds: b,
    massGrams: density ? (volume / 1000) * density : null,
    faces: shape.faces.length,
    edgesCount: shape.edges.length,
  };
}

/** Is the B-Rep topologically and geometrically valid? */
export function isValidSolid(oc, shape) {
  const a = new oc.BRepCheck_Analyzer(shape.wrapped, true, false, false);
  const ok = a.IsValid();
  a.delete();
  return ok;
}
