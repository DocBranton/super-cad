// Sample designs. The bracket is the acceptance scenario from the development contract:
// a two-part mounting bracket whose hole diameter can be edited and regenerated.
import { SCHEMA_ID } from "./plan-schema.js";

export const BRACKET = {
  schema: SCHEMA_ID,
  name: "Deployable Mounting Bracket",
  units: "mm",
  parameters: [
    { name: "length", expr: 100, unit: "mm", description: "Overall length" },
    { name: "width", expr: 40, unit: "mm", description: "Overall width" },
    { name: "base_thickness", expr: 10, unit: "mm", description: "Base plate thickness" },
    { name: "clamp_height", expr: 25, unit: "mm", description: "Upper clamp height" },
    { name: "tube_diameter", expr: 28, unit: "mm", description: "Clamped tube diameter" },
    { name: "hole_diameter", expr: 6, unit: "mm", description: "Mounting hole diameter" },
    { name: "hole_spacing", expr: 50, unit: "mm", description: "Hole spacing along the length" },
    { name: "wall", expr: 3, unit: "mm", description: "Wall thickness" },
    { name: "edge_radius", expr: 4, unit: "mm", description: "Corner fillet radius" },
  ],
  bodies: [
    {
      id: "lower_base",
      name: "Lower Base",
      material: "Aluminum 6061",
      color: "#aeb5bf",
      placement: [0, 0, 0],
      visible: true,
      features: [
        { id: "base_plate", name: "Base plate", op: "extrude", profile: { type: "rect", width: "length", height: "width", cornerRadius: "edge_radius" }, plane: "XY", at: [0, 0], offset: 0, distance: "base_thickness", mode: "new" },
        { id: "base_pad", name: "Pad", op: "extrude", profile: { type: "rect", width: "tube_diameter + 2 * wall * 3", height: "width" }, plane: "XY", at: [0, 0], offset: "base_thickness", distance: "tube_diameter / 2 - 4", mode: "join" },
        { id: "base_saddle", name: "Saddle", op: "extrude", profile: { type: "circle", diameter: "tube_diameter" }, plane: "XZ", at: [0, "base_thickness + tube_diameter / 2"], offset: 0, distance: "width + 2", symmetric: true, mode: "cut" },
        { id: "base_holes", name: "Mounting holes", op: "hole", face: "bottom", diameter: "hole_diameter", pattern: { countX: 2, countY: 2, spacingX: "length - 2 * 12", spacingY: "width - 2 * 10" }, countersink: { diameter: "hole_diameter * 2", angle: 90 } },
        { id: "base_edges", name: "Top edges", op: "chamfer", distance: 1, edges: "top" },
      ],
    },
    {
      id: "upper_clamp",
      name: "Upper Clamp",
      material: "Aluminum 6061",
      color: "#e8833a",
      placement: [0, 0, 0],
      visible: true,
      features: [
        { id: "clamp_block", name: "Clamp block", op: "extrude", profile: { type: "rect", width: "tube_diameter + 2 * wall * 3", height: "width" }, plane: "XY", at: [0, 0], offset: "base_thickness + tube_diameter / 2 - 4 + 2", distance: "clamp_height", mode: "new" },
        { id: "clamp_round", name: "Rounded corners", op: "fillet", radius: "edge_radius", edges: "vertical" },
        { id: "clamp_saddle", name: "Saddle", op: "extrude", profile: { type: "circle", diameter: "tube_diameter" }, plane: "XZ", at: [0, "base_thickness + tube_diameter / 2"], offset: 0, distance: "width + 2", symmetric: true, mode: "cut" },
        { id: "clamp_bolts", name: "Clamp bolts", op: "hole", face: "top", diameter: "hole_diameter * 0.9", positions: [["0 - (tube_diameter / 2 + wall * 1.6)", 0], ["tube_diameter / 2 + wall * 1.6", 0]] },
      ],
    },
  ],
  assumptions: [],
};

export const ENCLOSURE = {
  schema: SCHEMA_ID,
  name: "Radio Module Enclosure",
  units: "mm",
  parameters: [
    { name: "length", expr: 120, unit: "mm" },
    { name: "width", expr: 70, unit: "mm" },
    { name: "height", expr: 35, unit: "mm" },
    { name: "wall", expr: 2.5, unit: "mm" },
    { name: "corner", expr: 6, unit: "mm" },
    { name: "port", expr: 12, unit: "mm", description: "Connector port diameter" },
  ],
  bodies: [
    {
      id: "shell",
      name: "Enclosure",
      material: "PETG",
      color: "#8b9bb0",
      placement: [0, 0, 0],
      visible: true,
      features: [
        { id: "box", name: "Box", op: "extrude", profile: { type: "rect", width: "length", height: "width" }, plane: "XY", at: [0, 0], offset: 0, distance: "height", mode: "new" },
        { id: "corners", name: "Corners", op: "fillet", radius: "corner", edges: "vertical" },
        { id: "floor", name: "Floor edges", op: "fillet", radius: "wall * 1.5", edges: "bottom" },
        { id: "hollow", name: "Shell", op: "shell", thickness: "wall", openFace: "top" },
        { id: "ports", name: "Ports", op: "hole", face: "front", diameter: "port", depth: "wall * 2", positions: [["0 - length / 4", 0], ["length / 4", 0]] },
        { id: "vents", name: "Vent slots", op: "extrude", profile: { type: "slot", length: "width * 0.6", width: 3 }, plane: "XY", at: [0, 0], offset: -1, distance: "wall + 2", mode: "cut" },
      ],
    },
  ],
  assumptions: [],
};

export const IMPELLER = {
  schema: SCHEMA_ID,
  name: "Turbine Impeller",
  units: "mm",
  parameters: [
    { name: "hub_diameter", expr: 100, unit: "mm", description: "Hub outside diameter" },
    { name: "hub_thickness", expr: 12, unit: "mm" },
    { name: "bore_diameter", expr: 16, unit: "mm" },
    { name: "boss_diameter", expr: 32, unit: "mm", description: "Raised central boss" },
    { name: "boss_height", expr: 8, unit: "mm" },
    { name: "blade_count", expr: 12, unit: "", description: "Equally spaced; spacing follows the count" },
    { name: "blade_inner_radius", expr: 20, unit: "mm" },
    { name: "blade_outer_radius", expr: 48, unit: "mm" },
    { name: "blade_thickness", expr: 3, unit: "mm" },
    { name: "blade_height", expr: 20, unit: "mm", description: "Not specified; assumed" },
    { name: "blade_twist", expr: 25, unit: "deg", description: "Progressive twist root to tip" },
    { name: "blade_edge_fillet", expr: 0.75, unit: "mm", description: "Requested 2 mm; see assumptions" },
    { name: "bore_chamfer", expr: 1, unit: "mm" },
    { name: "mount_hole_count", expr: 6, unit: "" },
    { name: "mount_hole_diameter", expr: 5, unit: "mm" },
    { name: "bolt_circle_diameter", expr: 28, unit: "mm" },
    { name: "groove_diameter", expr: 90, unit: "mm", description: "Groove centreline, on the underside" },
    { name: "groove_width", expr: 2, unit: "mm" },
    { name: "groove_depth", expr: 1.5, unit: "mm" },
  ],
  bodies: [
    {
      id: "impeller",
      name: "Impeller",
      material: "Titanium Ti-6Al-4V",
      color: "#b9bec6",
      placement: [0, 0, 0],
      visible: true,
      features: [
        { id: "hub", name: "Hub", op: "extrude", profile: { type: "circle", diameter: "hub_diameter" }, plane: "XY", at: [0, 0], offset: 0, distance: "hub_thickness", mode: "new" },
        { id: "boss", name: "Central boss", op: "extrude", profile: { type: "circle", diameter: "boss_diameter" }, plane: "XY", at: [0, 0], offset: "hub_thickness", distance: "boss_height", mode: "join" },
        { id: "blades", name: "Blades", op: "extrude", profile: { type: "rect", width: "blade_outer_radius - blade_inner_radius", height: "blade_thickness" }, plane: "XY", at: ["(blade_inner_radius + blade_outer_radius) / 2", 0], offset: "hub_thickness", distance: "blade_height", twist: "blade_twist", circular: { count: "blade_count" }, mode: "join" },
        { id: "blade_edges", name: "Blade tip fillets", op: "fillet", radius: "blade_edge_fillet", edges: "top" },
        { id: "groove", name: "Perimeter groove", op: "extrude", profile: { type: "ring", outer: "groove_diameter + groove_width", inner: "groove_diameter - groove_width" }, plane: "XY", at: [0, 0], offset: 0, distance: "groove_depth", mode: "cut" },
        { id: "bore", name: "Bore", op: "hole", face: "top", diameter: "bore_diameter" },
        { id: "bore_chamfers", name: "Bore chamfers", op: "chamfer", distance: "bore_chamfer", edges: { diameter: "bore_diameter" } },
        { id: "mount_holes", name: "Mounting holes", op: "hole", face: "top", diameter: "mount_hole_diameter", circular: { count: "mount_hole_count", diameter: "bolt_circle_diameter", startAngle: "180 / mount_hole_count" } },
      ],
    },
  ],
  assumptions: [
    "NOT SUPPORTED: lofted blade profiles. Blades are twisted extrusions (25° about the part axis from root to tip), which give the same smooth, curved surfaces.",
    "NOT SUPPORTED: material appearance. The body uses Titanium Ti-6Al-4V for mass; colour approximates brushed titanium.",
    "CHECK: 2 mm fillets cannot fit on 3 mm blades (the limit is under 1.5 mm), and on twisted blades the kernel is reliable only to about 0.75 mm. Used 0.75 mm on the blade tips.",
    "CHECK: 5 mm holes on a 28 mm bolt circle reach radius 16.5 mm, past the 32 mm boss (radius 16 mm), so they break through the boss wall. Increase boss_diameter to at least 36 mm or reduce bolt_circle_diameter to 26 mm.",
    "Blade height was not specified; assumed 20 mm above the hub.",
    "The perimeter groove is on the underside so it does not cut under the blades: 2 mm wide, 1.5 mm deep, on a 90 mm centreline.",
    "Mounting holes are offset half a pitch so they sit between, not under, the blade roots.",
  ],
};

export const PLAQUE = {
  schema: SCHEMA_ID,
  name: "Plaque",
  units: "mm",
  parameters: [
    { name: "plaque_text", expr: "INNOVATION FORGE", unit: "text", description: "Raised lettering" },
    { name: "font_size", expr: 9, unit: "mm" },
    { name: "text_height", expr: 1.5, unit: "mm", description: "Extrusion depth of the lettering" },
    { name: "length", expr: 150, unit: "mm" },
    { name: "width", expr: 60, unit: "mm" },
    { name: "thickness", expr: 8, unit: "mm" },
    { name: "corner_radius", expr: 6, unit: "mm" },
    { name: "border_inset", expr: 5, unit: "mm", description: "Edge to outside of the border groove" },
    { name: "border_width", expr: 3, unit: "mm" },
    { name: "border_depth", expr: 1.5, unit: "mm" },
    { name: "hole_diameter", expr: 4.5, unit: "mm", description: "M4 clearance" },
    { name: "hole_inset", expr: 12, unit: "mm", description: "Hole centre from each end" },
  ],
  bodies: [
    {
      id: "plaque",
      name: "Plaque",
      material: "Aluminum 6061",
      color: "#c9ced6",
      placement: [0, 0, 0],
      visible: true,
      features: [
        { id: "plate", name: "Plate", op: "extrude", profile: { type: "rect", width: "length", height: "width", cornerRadius: "corner_radius" }, plane: "XY", at: [0, 0], offset: 0, distance: "thickness", mode: "new" },
        { id: "border_cut", name: "Border recess", op: "extrude", profile: { type: "rect", width: "length - 2 * border_inset", height: "width - 2 * border_inset", cornerRadius: "corner_radius / 2" }, plane: "XY", at: [0, 0], offset: "thickness - border_depth", distance: "border_depth + 1", mode: "cut" },
        { id: "panel", name: "Centre panel", op: "extrude", profile: { type: "rect", width: "length - 2 * (border_inset + border_width)", height: "width - 2 * (border_inset + border_width)", cornerRadius: "corner_radius / 3" }, plane: "XY", at: [0, 0], offset: "thickness - border_depth", distance: "border_depth", mode: "join" },
        { id: "lettering", name: "Raised text", op: "extrude", profile: { type: "text", text: "plaque_text", size: "font_size", font: "sans-bold" }, plane: "XY", at: [0, 0], offset: "thickness", distance: "text_height", mode: "join" },
        { id: "mount_holes", name: "Mounting holes", op: "hole", face: "bottom", diameter: "hole_diameter", positions: [["0 - (length / 2 - hole_inset)", 0], ["length / 2 - hole_inset", 0]], countersink: { diameter: "hole_diameter * 2", angle: 90 } },
      ],
    },
  ],
  assumptions: [
    "Recessed border: a groove 3 mm wide and 1.5 mm deep, 5 mm in from the edge, following the rounded corners.",
    "Mounting holes: 4.5 mm (M4 clearance), 12 mm from each end, countersunk from the back so screws sit flush behind the plaque.",
    "Font: Roboto Bold (bundled with the app). Font size 9 mm keeps the text clear of the holes.",
  ],
};

export const SAMPLES = { bracket: BRACKET, enclosure: ENCLOSURE, impeller: IMPELLER, plaque: PLAQUE };
