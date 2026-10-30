// Headless tests of the geometry engine on the real Open CASCADE kernel.
// Run with: npm test
import { test, before } from "node:test";
import assert from "node:assert/strict";
import opencascade from "replicad-opencascadejs";
import * as r from "replicad";
import { parsePlan } from "../shared/plan-schema.js";
import { evaluate, resolveParameters } from "../shared/expr.js";
import { SAMPLES } from "../shared/samples.js";
import { regenerate, describe, isValidSolid } from "../src/engine/regenerate.js";
import { validateBodies } from "../src/engine/validate.js";

let oc;
before(async () => {
  oc = await opencascade();
  r.setOC(oc);
  const { loadFonts } = await import("../src/engine/regenerate.js");
  const { readFileSync } = await import("node:fs");
  await loadFonts(r, async (key, path) => {
    const b = readFileSync(new URL(`../node_modules/${path}`, import.meta.url));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  });
});

const clone = (x) => JSON.parse(JSON.stringify(x));

test("expressions: arithmetic, precedence and names", () => {
  assert.equal(evaluate("2 + 3 * 4", () => 0), 14);
  assert.equal(evaluate("(length - 2 * 12) / 2", (n) => ({ length: 100 })[n]), 38);
  assert.equal(evaluate("-a + 1", () => 4), -3);
  assert.throws(() => evaluate("a.b", () => 1));
  assert.throws(() => evaluate("alert(1)", () => 1));
  assert.throws(() => evaluate("1 / 0", () => 1));
});

test("parameters: cycles and unknown names are reported, not thrown", () => {
  const { values, errors } = resolveParameters([
    { name: "a", expr: "b + 1" },
    { name: "b", expr: "a + 1" },
    { name: "c", expr: "missing * 2" },
    { name: "d", expr: 5 },
  ]);
  assert.equal(values.d, 5);
  assert.match(errors.a, /circular/);
  assert.match(errors.c, /unknown parameter/);
});

test("schema rejects code and unknown operations", () => {
  assert.throws(() => parsePlan({ name: "x", bodies: [{ id: "b", name: "B", features: [{ id: "f", op: "python", code: "import os" }] }] }));
  assert.throws(() => parsePlan({ name: "x", parameters: [{ name: "__proto__.x", expr: 1 }], bodies: [] }));
});

for (const [key, sample] of Object.entries(SAMPLES)) {
  test(`sample "${key}" regenerates to valid solids`, () => {
    const plan = parsePlan(clone(sample));
    const out = regenerate(r, plan);
    for (const [id, s] of Object.entries(out.features)) assert.equal(s.state, "ok", `${id}: ${s.message}`);
    for (const b of out.bodies) {
      assert.ok(b.shape, `${b.name} has a solid`);
      assert.ok(isValidSolid(oc, b.shape), `${b.name} is a valid B-Rep`);
      const d = describe(r, b, plan.bodies.find((x) => x.id === b.id).material);
      assert.ok(d.volume > 0 && d.triangles.length > 0);
    }
  });
}

test("bracket: editing hole_diameter regenerates deterministically and removes material", () => {
  const plan = parsePlan(clone(SAMPLES.bracket));
  const vol = (p) => r.measureVolume(regenerate(r, p).bodies[0].shape);
  const v6 = vol(plan);
  assert.equal(vol(plan), v6, "same input, same volume");
  plan.parameters.find((p) => p.name === "hole_diameter").expr = 8;
  assert.ok(vol(plan) < v6, "larger holes, less material");
});

test("bracket: STEP round trip, no interference, mass computed", async () => {
  const plan = parsePlan(clone(SAMPLES.bracket));
  const out = regenerate(r, plan);
  const report = await validateBodies(r, oc, plan, out.bodies);
  const failed = report.checks.filter((c) => c.status === "fail");
  assert.deepEqual(failed, [], JSON.stringify(failed));
  assert.ok(report.checks.some((c) => c.id.startsWith("step-roundtrip") && c.status === "pass"));
  assert.ok(report.checks.some((c) => c.id === "interference" && c.status === "pass"));
});

test("a bad fillet fails that feature only, with a readable message", () => {
  const plan = parsePlan(clone(SAMPLES.enclosure));
  plan.bodies[0].features.find((f) => f.id === "corners").radius = 80;
  const out = regenerate(r, plan);
  assert.equal(out.features.box.state, "ok");
  assert.equal(out.features.corners.state, "error");
  assert.match(out.features.corners.message, /fillet/);
  assert.equal(out.features.hollow.state, "skipped");
  assert.ok(out.bodies[0].shape, "last good solid is kept");
});

test("rollback evaluates only the first N timeline entries", () => {
  const plan = parsePlan(clone(SAMPLES.enclosure));
  const out = regenerate(r, plan, { rollback: 2 });
  assert.equal(out.features.corners.state, "ok");
  assert.equal(out.features.floor.state, "rolled-back");
});

test("generic material names still give a mass", async () => {
  const { densityOf } = await import("../src/engine/regenerate.js");
  assert.equal(densityOf("Aluminium"), 2.7);
  assert.equal(densityOf("stainless steel"), 8.0);
  assert.equal(densityOf("unobtainium"), undefined);
});

test("impeller: valid single solid, and stays valid as parameters change", async () => {
  const { IMPELLER } = await import("../shared/samples.js");
  const variants = [
    {},
    { blade_count: 8 },
    { blade_count: 16 },
    { blade_twist: 15 },
    { hub_diameter: 120, blade_outer_radius: 56, groove_diameter: 110 },
    { bore_diameter: 12, boss_diameter: 36 },
    { blade_thickness: 4 },
  ];
  for (const v of variants) {
    const plan = parsePlan(clone(IMPELLER));
    for (const [k, val] of Object.entries(v)) plan.parameters.find((p) => p.name === k).expr = val;
    const out = regenerate(r, plan);
    const bad = Object.entries(out.features).filter(([, s]) => s.state !== "ok");
    assert.deepEqual(bad, [], `${JSON.stringify(v)}: ${JSON.stringify(bad)}`);
    const s = out.bodies[0].shape;
    assert.equal(s.solids.length, 1, `${JSON.stringify(v)}: one solid`);
    assert.ok(isValidSolid(oc, s), `${JSON.stringify(v)}: valid B-Rep`);
  }
});

test("circular pattern spacing follows the count", () => {
  const plan = parsePlan({
    name: "pattern",
    parameters: [{ name: "n", expr: 5 }],
    bodies: [{ id: "b", name: "B", features: [
      { id: "disc", op: "extrude", profile: { type: "circle", diameter: 60 }, distance: 5, mode: "new" },
      { id: "holes", op: "hole", face: "top", diameter: 4, circular: { count: "n", diameter: 40 } },
      { id: "ring", op: "extrude", profile: { type: "ring", outer: 56, inner: 52 }, distance: 1, mode: "cut" },
      { id: "c", op: "chamfer", distance: 0.5, edges: { diameter: 4 } },
    ] }],
  });
  const out = regenerate(r, plan);
  for (const [id, s] of Object.entries(out.features)) assert.equal(s.state, "ok", `${id}: ${s.message}`);
  assert.match(out.features.holes.note, /5 holes/);
});

test("plaque: raised editable text fuses into one valid solid", async () => {
  const { PLAQUE } = await import("../shared/samples.js");
  for (const words of ["INNOVATION FORGE", "AIRMEN 2026", "A"]) {
    const plan = parsePlan(clone(PLAQUE));
    plan.parameters.find((p) => p.name === "plaque_text").expr = words;
    const out = regenerate(r, plan);
    for (const [id, s] of Object.entries(out.features)) assert.equal(s.state, "ok", `${words} ${id}: ${s.message}`);
    const s = out.bodies[0].shape;
    assert.equal(s.solids.length, 1, `${words}: one solid`);
    assert.ok(isValidSolid(oc, s), `${words}: valid`);
  }
});

test("text parameters are not evaluated as numbers", () => {
  const { values, errors } = resolveParameters([{ name: "t", expr: "HELLO WORLD", unit: "text" }, { name: "n", expr: "t * 2" }]);
  assert.equal(values.t, undefined);
  assert.match(errors.n, /is text/);
});

