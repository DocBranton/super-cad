// Offline planner and schema guarantees. The model-backed planner shares the same validation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { offlinePlan } from "../server/planner.js";
import { parsePlan } from "../shared/plan-schema.js";
import { BRACKET } from "../shared/samples.js";

const param = (plan, name) => plan.parameters.find((p) => p.name === name)?.expr;

test("enclosure request picks the enclosure template and reads dimensions", () => {
  const p = offlinePlan("Radio module enclosure 140 mm long, 80 mm wide, 40 mm tall, 3 mm wall, PETG, two 14 mm connector ports.");
  assert.equal(param(p, "length"), 140);
  assert.equal(param(p, "width"), 80);
  assert.equal(param(p, "height"), 40);
  assert.equal(param(p, "wall"), 3);
  assert.equal(param(p, "port"), 14);
  assert.equal(p.bodies[0].material, "PETG");
});

test("bracket request reads length, width and metric bolt size", () => {
  const p = offlinePlan("Design a rugged equipment mount for a communications module: aluminum, 120 mm long, 50 mm wide, M5 mounting holes.");
  assert.equal(param(p, "length"), 120);
  assert.equal(param(p, "width"), 50);
  assert.equal(param(p, "hole_diameter"), 5.5);
  assert.equal(p.bodies[0].material, "Aluminum 6061");
});

test("modify mode edits the current design instead of starting over", () => {
  const current = parsePlan(structuredClone(BRACKET));
  current.parameters.find((x) => x.name === "length").expr = 130;
  const p = offlinePlan("Make the mounting holes 8 mm and the base plate 12 mm thick.", current);
  assert.equal(param(p, "hole_diameter"), 8);
  assert.equal(param(p, "length"), 130, "untouched parameters are kept");
});

test("modify mode still switches template when the request names a different part", () => {
  const current = parsePlan(structuredClone(BRACKET));
  const p = offlinePlan("Radio module enclosure 140 mm long", current);
  assert.ok(p.bodies.some((b) => b.id === "shell"));
});

test("every plan the planner returns passes the schema", () => {
  for (const prompt of ["", "a thing", "bracket 9999 mm long", "box with 0 mm wall"]) {
    const p = offlinePlan(prompt);
    assert.doesNotThrow(() => parsePlan(p));
  }
});

test("plaque request: dimensions, quoted text and parameters", () => {
  const p = offlinePlan('Create a 150 × 60 × 8 mm plaque with rounded corners, a recessed border, two mounting holes, and raised editable text reading "INNOVATION FORGE". Expose text, font size, and extrusion depth as parameters.');
  assert.equal(param(p, "length"), 150);
  assert.equal(param(p, "width"), 60);
  assert.equal(param(p, "thickness"), 8);
  assert.equal(param(p, "plaque_text"), "INNOVATION FORGE");
  assert.ok(p.parameters.some((x) => x.name === "font_size"));
  assert.ok(p.parameters.some((x) => x.name === "text_height"));
});
