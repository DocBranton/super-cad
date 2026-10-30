import { test, before } from "node:test";
import assert from "node:assert/strict";
import opencascade from "replicad-opencascadejs";
import * as r from "replicad";

// Exercises the exact STEP file reader and Boolean operations used by the browser worker.
let oc;
before(async () => {
  oc = await opencascade();
  r.setOC(oc);
});

test("real B-Rep STEP import, hole cut, and export round-trip", async () => {
  const plate = r.drawRectangle(80, 50).sketchOnPlane("XY").extrude(10);
  const before = r.measureVolume(plate);
  const source = r.exportSTEP([{shape: plate, name:"Test plate"}], {unit:"mm"});
  const imported = await r.importSTEP(source);
  assert.ok(imported.solids.length >= 1, "STEP yields real solids");
  assert.ok(Math.abs(r.measureVolume(imported) - before) / before < 1e-5);
  const hole = r.makeCylinder(4, 14, [0, 0, -2], [0, 0, 1]);
  const modified = imported.cut(hole);
  assert.ok(r.measureVolume(modified) < r.measureVolume(imported), "hole removes material");
  const analyzer = new oc.BRepCheck_Analyzer(modified.wrapped, true, false, false);
  assert.equal(analyzer.IsValid(), true, "cut produces valid B-Rep");
  analyzer.delete();
  const revised = await r.importSTEP(r.exportSTEP([{shape: modified,name:"Revised plate"}], {unit:"mm"}));
  assert.ok(Math.abs(r.measureVolume(revised) - r.measureVolume(modified)) < 0.01, "modified STEP round-trips");
});
