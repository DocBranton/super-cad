// SI planner: turns a design narrative into a schema-validated feature plan.
// The model only ever returns JSON data; the plan is validated here and again in the
// geometry worker, and the user approves it before anything is built.
import { parsePlan, PLAN_GUIDE } from "../shared/plan-schema.js";
import { BRACKET, ENCLOSURE, IMPELLER, PLAQUE } from "../shared/samples.js";
import { api, isConfigured } from "./databricks.js";

const SYSTEM = `You are the planning component of a parametric mechanical CAD workbench used by service members.
You convert a design request into a feature plan for a deterministic CAD kernel. You never write code.
${PLAN_GUIDE}`;

export function siStatus() {
  const endpoint = process.env.SERVING_ENDPOINT;
  const reason = !endpoint
    ? "SERVING_ENDPOINT is empty: bind a serving endpoint to the app with resource key serving-endpoint, keep the SERVING_ENDPOINT entry in app.yaml, then redeploy."
    : !isConfigured()
      ? "DATABRICKS_HOST is not set (it is set automatically inside Databricks Apps; set it for local runs)."
      : null;
  return { configured: !reason, endpoint: endpoint || null, reason };
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("the model did not return a JSON object");
  return JSON.parse(text.slice(start, end + 1));
}

async function callModel(req, messages) {
  const endpoint = encodeURIComponent(process.env.SERVING_ENDPOINT);
  const res = await api(req, `/serving-endpoints/${endpoint}/invocations`, {
    method: "POST",
    body: { messages, max_tokens: 4000, temperature: 0 },
    identity: "app", // the endpoint is bound to the app with CAN_QUERY; users stay in the audit log
  });
  const j = await res.json();
  const content = j.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map((c) => c.text ?? "").join("") : content;
  if (!text) throw new Error("empty response from the serving endpoint");
  return text;
}

/** Plan with the configured Model Serving endpoint; one repair attempt on schema errors. */
async function modelPlan(req, prompt, current) {
  const messages = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: current
        ? `Current plan (modify it; keep ids of unchanged features):\n${JSON.stringify(current)}\n\nRequest: ${prompt}`
        : `Request: ${prompt}`,
    },
  ];
  let text = await callModel(req, messages);
  try {
    return parsePlan(extractJson(text));
  } catch (e) {
    messages.push({ role: "assistant", content: text }, { role: "user", content: `That plan is invalid: ${e.message}. Return the corrected JSON object only.` });
    text = await callModel(req, messages);
    return parsePlan(extractJson(text));
  }
}

// ---------------------------------------------------------------------------------------------
// Offline planner: deterministic, keyword-driven, for development and for environments where no
// approved model endpoint is configured yet. It only adjusts parameters of known templates.

const MATERIAL_WORDS = [
  [/7075/i, "Aluminum 7075"],
  [/alumin(i)?um|6061/i, "Aluminum 6061"],
  [/stainless|316/i, "Stainless 316"],
  [/steel/i, "Steel 1018"],
  [/titanium/i, "Titanium Ti-6Al-4V"],
  [/petg/i, "PETG"],
  [/\bpla\b/i, "PLA"],
  [/\babs\b/i, "ABS"],
  [/nylon|pa12/i, "Nylon PA12"],
];

const NUM = "(?<![A-Za-z\\d.])(\\d+(?:\\.\\d+)?)\\s*(?:mm|millimet(?:er|re)s?)?";

/** The number most tightly bound to one of `words`: "140 mm long" or "length 140", whichever is closer. */
function findNumber(text, words) {
  let best;
  for (const w of words) {
    const after = new RegExp(`\\b${w}\\b([^\\d.;]{0,20}?)${NUM}`, "i").exec(text);
    if (after && (!best || after[1].length < best.gap)) best = { gap: after[1].length, value: parseFloat(after[2]) };
    const before = new RegExp(`${NUM}(\\s*(?:mm)?\\s*(?:-\\s*)?)${w}\\b`, "i").exec(text);
    if (before && (!best || before[2].length < best.gap)) best = { gap: before[2].length, value: parseFloat(before[1]) };
  }
  return best?.value;
}

export function offlinePlan(prompt, current) {
  const text = String(prompt);
  const assumptions = [];
  let plan;
  const wantsEnclosure = /enclosure|housing|\bbox\b|\bcase\b/i.test(text) && !/bracket|clamp|mount(?:ing)? plate/i.test(text);
  const wantsBracket = /bracket|clamp|\bmount\b/i.test(text);
  const wantsImpeller = /impeller|turbine|blades?\b|\bfan\b|rotor/i.test(text);
  const wantsPlaque = /plaque|nameplate|name plate|placard|\bsign\b|badge|text|lettering|engrav/i.test(text);
  const intent = wantsImpeller ? "impeller" : wantsPlaque ? "plaque" : wantsEnclosure ? "enclosure" : wantsBracket ? "bracket" : null;
  const currentKind = current?.bodies.some((b) => b.id === "impeller") ? "impeller" : current?.bodies.some((b) => b.id === "plaque") ? "plaque" : current?.bodies.some((b) => b.id === "shell") ? "enclosure" : current?.bodies.some((b) => b.id === "lower_base") ? "bracket" : "other";
  if (current && !/\b(new|another|instead)\b/i.test(text) && (!intent || intent === currentKind)) {
    plan = structuredClone(current);
  } else if (intent === "plaque") {
    plan = structuredClone(PLAQUE);
    assumptions.push(...PLAQUE.assumptions);
  } else if (intent === "impeller") {
    plan = structuredClone(IMPELLER);
    assumptions.push(...IMPELLER.assumptions);
  } else if (intent === "enclosure") {
    plan = structuredClone(ENCLOSURE);
    assumptions.push("Matched the enclosure template (box, filleted corners, shelled, two front ports, vent slot).");
  } else {
    plan = structuredClone(BRACKET);
    assumptions.push("Matched the two-piece tube-clamp bracket template (base with countersunk holes, upper clamp).");
  }

  const synonyms = {
    length: ["long", "length", "overall length"],
    width: ["wide", "width"],
    height: ["tall", "high", "height"],
    clamp_height: ["clamp height"],
    base_thickness: ["base thickness", "plate thickness", "base"],
    wall: ["thick", "wall", "wall thickness"],
    hole_diameter: ["hole diameter", "holes?", "bolt holes?", "mounting holes?"],
    hole_spacing: ["hole spacing", "spacing", "apart"],
    tube_diameter: ["tube", "pipe", "mast", "tube diameter"],
    edge_radius: ["fillets?", "radius", "rounded"],
    corner: ["corner radius", "corners?", "fillets?"],
    port: ["port", "connector"],
    font_size: ["font size", "text size", "letter height"],
    text_height: ["extrusion depth", "text depth", "text height", "raised by"],
  };
  const changed = [];
  const setParam = (name, v, why) => {
    const p = plan.parameters.find((x) => x.name === name);
    if (p && p.expr !== v) {
      changed.push(`${name} ${JSON.stringify(p.expr)} → ${JSON.stringify(v)}${why ? ` (${why})` : ""}`);
      p.expr = v;
    }
  };
  const dims = /(\d+(?:\.\d+)?)\s*(?:mm)?\s*[×x*]\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*[×x*]\s*(\d+(?:\.\d+)?)/i.exec(text);
  if (dims) {
    const [l, w, t] = dims.slice(1).map(Number);
    setParam("length", l);
    setParam("width", w);
    setParam(plan.parameters.some((p) => p.name === "thickness") ? "thickness" : "height", t);
  }
  const quoted = /["“”']([^"“”']{1,80})["“”']/.exec(text);
  const textParam = plan.parameters.find((p) => p.unit === "text");
  if (quoted && textParam) setParam(textParam.name, quoted[1]);
  const taken = new Set(changed.map((c) => c.split(" ")[0]));
  for (const p of plan.parameters) {
    if (p.unit === "text" || taken.has(p.name)) continue;
    const words = [p.name.replace(/_/g, " "), ...(synonyms[p.name] ?? [])];
    const v = findNumber(text, words);
    if (v !== undefined && v > 0 && v !== p.expr) {
      changed.push(`${p.name} ${p.expr} → ${v}`);
      p.expr = v;
    }
  }
  const metric = /\bM(\d+(?:\.\d+)?)\b/.exec(text);
  const holeParam = plan.parameters.find((p) => p.name === "hole_diameter");
  if (metric && holeParam && !changed.some((c) => c.startsWith("hole_diameter"))) {
    const d = Math.round(parseFloat(metric[1]) * 1.1 * 10) / 10;
    changed.push(`hole_diameter ${holeParam.expr} → ${d} (M${metric[1]} clearance)`);
    holeParam.expr = d;
  }
  for (const [re, material] of MATERIAL_WORDS) {
    if (re.test(text)) {
      plan.bodies.forEach((b) => (b.material = material));
      changed.push(`material → ${material}`);
      break;
    }
  }
  if (/countersunk|countersink/i.test(text)) assumptions.push("Countersinks are 90° and twice the hole diameter.");
  if (changed.length) assumptions.push(`Set from your description: ${changed.join(", ")}.`);
  else assumptions.push("No dimensions recognised in the description; template defaults kept.");
  assumptions.push("Offline planner: only template parameters can change. Configure a Model Serving endpoint for open-ended designs.");
  plan.assumptions = assumptions;
  return parsePlan(plan);
}

export async function plan(req, { prompt, current }) {
  if (typeof prompt !== "string" || !prompt.trim()) throw Object.assign(new Error("describe what you want to design"), { status: 400 });
  if (prompt.length > 4000) throw Object.assign(new Error("the description is too long (4,000 characters max)"), { status: 400 });
  const currentPlan = current ? parsePlan(current) : undefined;
  const status = siStatus();
  const t0 = Date.now();
  if (status.configured) {
    const p = await modelPlan(req, prompt, currentPlan);
    return { plan: p, planner: `Model Serving: ${status.endpoint}`, ms: Date.now() - t0 };
  }
  return { plan: offlinePlan(prompt, currentPlan), planner: "Offline template planner", ms: Date.now() - t0 };
}
