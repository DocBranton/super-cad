import opencascade from "replicad-opencascadejs";
import * as r from "replicad";
import { readFileSync } from "node:fs";
r.setOC(await opencascade());
const buf = readFileSync("node_modules/@fontsource/roboto/files/roboto-latin-700-normal.woff");
await r.loadFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "sans-bold");
const oc = r.getOC();
const plate = r.drawRoundedRectangle(150, 60, 6).sketchOnPlane("XY").extrude(8).cut(r.drawRoundedRectangle(140, 50, 3).sketchOnPlane("XY", 6).extrude(3));
for (const [label, z0, h] of [["coplanar", 6, 1.5], ["embedded", 5.95, 1.55]]) {
  const d0 = r.drawText("INNOVATION FORGE", { fontSize: 10, fontFamily: "sans-bold" });
  const [[x0, y0], [x1, y1]] = d0.boundingBox.bounds;
  const d = d0.translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
  const txt = d.sketchOnPlane("XY", z0).extrude(h);
  console.log(label, "text solids", txt.solids?.length);
  const s = plate.fuse(txt);
  console.log(label, "solids", s.solids.length, "valid", new oc.BRepCheck_Analyzer(s.wrapped, true, false, false).IsValid(), "vol", r.measureVolume(s).toFixed(0));
}
