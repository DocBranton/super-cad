// Feature-plan schema: the only thing the SI planner, the UI and the geometry worker exchange.
// A plan is data, never code. Every value is a number or a small arithmetic expression over
// named parameters (see shared/expr.js), so nothing in a plan can execute.
import { z } from "zod";

export const SCHEMA_ID = "si-cad/feature-plan@1";

const name = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,40}$/, "use letters, digits and _");
const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
/** A number, or an expression such as "length / 2 - 8". */
export const Value = z.union([z.number().finite(), z.string().min(1).max(200)]);
const Vec2 = z.tuple([Value, Value]);
const Vec3 = z.tuple([Value, Value, Value]);

export const PlaneName = z.enum(["XY", "XZ", "YZ"]);
export const FaceName = z.enum(["top", "bottom", "front", "back", "left", "right"]);
export const EdgeSet = z.union([
  z.enum(["all", "vertical", "top", "bottom"]),
  /** Circular edges of this diameter, e.g. both ends of a bore. */
  z.object({ diameter: Value }),
]);
/** Equally spaced copies about the part's Z axis; spacing follows the count. */
const Circular = z.object({ count: Value, startAngle: Value.optional() });

export const Profile = z.discriminatedUnion("type", [
  z.object({ type: z.literal("rect"), width: Value, height: Value, cornerRadius: Value.optional() }),
  z.object({ type: z.literal("circle"), diameter: Value }),
  z.object({ type: z.literal("slot"), length: Value, width: Value }),
  z.object({ type: z.literal("ring"), outer: Value, inner: Value }),
  /** Text centred on "at". "text" is literal, or the name of a parameter whose unit is "text". */
  z.object({ type: z.literal("text"), text: z.string().min(1).max(80), size: Value, font: z.enum(["sans", "sans-bold", "mono"]).default("sans-bold") }),
]);

const base = { id, name: z.string().max(60).optional(), suppressed: z.boolean().optional() };

export const Feature = z.discriminatedUnion("op", [
  z.object({
    ...base,
    op: z.literal("extrude"),
    profile: Profile,
    plane: PlaneName.default("XY"),
    /** Profile centre within the plane. */
    at: Vec2.default([0, 0]),
    /** Distance of the sketch plane from the origin along its normal. */
    offset: Value.default(0),
    distance: Value,
    symmetric: z.boolean().optional(),
    /** Progressive twist in degrees over the extrusion, about the plane normal through the origin. */
    twist: Value.optional(),
    circular: Circular.optional(),
    mode: z.enum(["new", "join", "cut"]).default("new"),
  }),
  z.object({
    ...base,
    op: z.literal("hole"),
    face: FaceName.default("top"),
    diameter: Value,
    /** Omit for a through hole. */
    depth: Value.optional(),
    /** Positions on the face, relative to the face centre. */
    positions: z.array(Vec2).max(64).optional(),
    pattern: z
      .object({ countX: Value, countY: Value, spacingX: Value, spacingY: Value })
      .optional(),
    /** Holes on a bolt circle centred on the face centre. */
    circular: Circular.extend({ diameter: Value }).optional(),
    countersink: z.object({ diameter: Value, angle: Value.default(90) }).optional(),
  }),
  z.object({ ...base, op: z.literal("fillet"), radius: Value, edges: EdgeSet.default("vertical") }),
  z.object({ ...base, op: z.literal("chamfer"), distance: Value, edges: EdgeSet.default("top") }),
  z.object({ ...base, op: z.literal("shell"), thickness: Value, openFace: FaceName.default("top") }),
]);

export const Parameter = z.object({
  name,
  expr: Value,
  /** "text" parameters hold words (e.g. an engraving), not numbers, and are never evaluated. */
  unit: z.enum(["mm", "deg", "", "text"]).default("mm"),
  description: z.string().max(120).optional(),
});

export const Body = z.object({
  id,
  name: z.string().min(1).max(60),
  material: z.string().max(40).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  placement: Vec3.default([0, 0, 0]),
  visible: z.boolean().default(true),
  features: z.array(Feature).min(1).max(60),
});

export const Plan = z.object({
  schema: z.literal(SCHEMA_ID).default(SCHEMA_ID),
  name: z.string().min(1).max(80),
  units: z.literal("mm").default("mm"),
  parameters: z.array(Parameter).max(60).default([]),
  bodies: z.array(Body).min(1).max(12),
  /** Assumptions the planner made, shown to the user before approval. */
  assumptions: z.array(z.string().max(400)).max(20).default([]),
});

/** Parse and normalise a plan; throws a readable error listing every problem. */
export function parsePlan(input) {
  const r = Plan.safeParse(input);
  if (r.success) return r.data;
  const issues = r.error.issues.slice(0, 12).map((i) => `${i.path.join(".") || "plan"}: ${i.message}`);
  throw new Error("Invalid feature plan — " + issues.join("; "));
}

/** JSON-schema-ish description given to the model so it knows the exact shape. */
export const PLAN_GUIDE = `
Return ONE JSON object, no prose, matching:
{
 "schema": "${SCHEMA_ID}", "name": string, "units": "mm",
 "parameters": [{"name": identifier, "expr": number|expression, "unit": "mm"|"deg"|"", "description"?: string}],
 "bodies": [{"id": string, "name": string, "material"?: string, "color"?: "#rrggbb",
   "placement": [x,y,z], "features": [Feature, ...]}],
 "assumptions": [string]
}
Feature is one of (every feature has "id" and a short human "name"):
 {"op":"extrude","profile":P,"plane":"XY"|"XZ"|"YZ","at":[u,v],"offset":n,"distance":n,"symmetric"?:bool,
   "twist"?:degrees,"circular"?:{"count":n,"startAngle"?:degrees},"mode":"new"|"join"|"cut"}
   P = {"type":"rect","width","height","cornerRadius"?} | {"type":"circle","diameter"}
     | {"type":"slot","length","width"} | {"type":"ring","outer","inner"}   (ring = annulus, diameters)
     | {"type":"text","text":"WORDS" or a text parameter's name,"size":font size in mm,"font":"sans"|"sans-bold"|"mono"}
   Text is centred on "at". Extrude it with mode "join" for raised lettering or "cut" for engraving.
   Put editable wording in a parameter with "unit":"text" and "expr":"THE WORDS", and set the
   profile's "text" to that parameter's name.
   "at" moves the profile centre within the plane; "offset" lifts the plane along its normal.
   "twist" rotates the profile progressively over the distance about the plane normal through the
   origin (for XY: the part's Z axis) — use it for curved/twisted blades instead of lofts.
   "circular" makes count equally spaced copies of this feature about the Z axis.
 {"op":"hole","face":"top"|"bottom"|"front"|"back"|"left"|"right","diameter","depth"? (omit = through),
   "positions"?:[[u,v],...] relative to the face centre, "pattern"?:{"countX","countY","spacingX","spacingY"},
   "circular"?:{"count","diameter","startAngle"?} (bolt circle about the face centre),
   "countersink"?:{"diameter","angle"}}
 {"op":"fillet","radius","edges":"all"|"vertical"|"top"|"bottom"|{"diameter":d}}
 {"op":"chamfer","distance","edges":"all"|"vertical"|"top"|"bottom"|{"diameter":d}}
   "top"/"bottom" = edges lying in the highest/lowest plane of the body; {"diameter":d} = circular
   edges of that diameter (e.g. both ends of a bore).
 {"op":"shell","thickness","openFace":face}
Rules:
- The first feature of every body is an extrude with mode "new". A feature that adds material
  must touch or overlap the existing body (e.g. blades start at the top face of the hub).
- Every dimension the user mentions becomes a named parameter; features reference parameters
  by name in expressions using only + - * / ( ). Counts and angles are parameters too.
- Fillet radius must be smaller than half the thinnest wall it touches; when a body is shelled,
  fillet before shelling with a radius larger than the shell thickness.
- Use one of these material names exactly: "Aluminum 6061", "Aluminum 7075", "Steel 1018",
  "Stainless 316", "Titanium Ti-6Al-4V", "PETG", "PLA", "ABS", "Nylon PA12".
- Be honest in "assumptions". Start an assumption with "NOT SUPPORTED:" for anything requested
  that these operations cannot do and say what you did instead. Start with "CHECK:" for any
  requested dimension that conflicts with another or cannot be built (e.g. a fillet larger than
  the wall), and say what value you used. List every other guess plainly.
Units are millimetres.`;
