// One command registry for the ribbon, menus, keyboard and the command line, so every
// surface runs the same actions (the same idea as SolidCraft's command registry).
import {
  addBody, addFeature, exportGeometry, exportPlanJson, getState, redo, replacePlan, requestView,
  runValidation, saveProject, setParameter, setState, undo, deleteFeature, commit, type Feature,
} from "./state/store";
import { SAMPLES } from "../shared/samples.js";
import { parsePlan } from "../shared/plan-schema.js";

export type Command = {
  id: string;
  label: string;
  hint?: string;
  kbd?: string;
  run: (args?: Record<string, unknown>) => void;
  planned?: boolean;
};

const feature = (op: Feature["op"]) => (args?: Record<string, unknown>) => {
  // On the command line, `extrude {"distance": 20}` edits the selected extrude, otherwise adds one.
  const s = getState();
  const selected = s.selection?.kind === "feature" ? s.selection.id : null;
  if (args && selected) {
    const body = s.plan.bodies.find((b) => b.features.some((f) => f.id === selected));
    const f = body?.features.find((x) => x.id === selected);
    if (f && f.op === op) {
      commit((p) => Object.assign(p.bodies.find((b) => b.id === body!.id)!.features.find((x) => x.id === selected)!, args), `${f.name ?? op} updated`);
      return;
    }
  }
  addFeature(op, args ?? {});
};

const planned = (id: string, label: string): Command => ({
  id,
  label,
  planned: true,
  run: () => setState({ status: `${label} is planned — not part of this spike` }),
});

export const COMMANDS: Command[] = [
  { id: "extrude", label: "Extrude", hint: 'extrude {"distance": 20}', kbd: "E", run: feature("extrude") },
  { id: "hole", label: "Hole", hint: 'hole {"diameter": 6}', kbd: "H", run: feature("hole") },
  { id: "fillet", label: "Fillet", hint: 'fillet {"radius": 3}', kbd: "F", run: feature("fillet") },
  { id: "chamfer", label: "Chamfer", hint: 'chamfer {"distance": 1}', run: feature("chamfer") },
  { id: "shell", label: "Shell", hint: 'shell {"thickness": 2}', run: feature("shell") },
  { id: "body", label: "New body", hint: "body", run: addBody },
  { id: "parameters", label: "Change parameters", hint: "parameters", kbd: "P", run: () => setState({ dialog: "parameters" }) },
  { id: "set", label: "Set a parameter", hint: "length = 120", run: (a) => a && setParameter(String(a.name), a.value as number | string) },
  { id: "validate", label: "Validate (engineering checks)", hint: "validate", kbd: "V", run: runValidation },
  { id: "interference", label: "Interference", hint: "interference", run: runValidation },
  { id: "properties", label: "Properties", hint: "properties", run: () => setState({ dialog: "properties" }) },
  { id: "export-step", label: "Export STEP", hint: "export step", run: () => exportGeometry("step") },
  { id: "export-stl", label: "Export STL", hint: "export stl", run: () => exportGeometry("stl") },
  { id: "export-plan", label: "Export feature plan (JSON)", hint: "export plan", run: exportPlanJson },
  { id: "save", label: "Save revision", hint: "save", kbd: "Ctrl+S", run: () => saveProject() },
  { id: "open", label: "Open project", hint: "open", kbd: "Ctrl+O", run: () => setState({ dialog: "projects" }) },
  { id: "undo", label: "Undo", kbd: "Ctrl+Z", run: undo },
  { id: "redo", label: "Redo", kbd: "Ctrl+Y", run: redo },
  { id: "delete", label: "Delete selected feature", kbd: "Del", run: () => { const s = getState(); if (s.selection?.kind === "feature") deleteFeature(s.selection.id); } },
  { id: "fit", label: "Fit to view", hint: "fit", kbd: "F6", run: () => requestView("fit") },
  { id: "view", label: "Named view", hint: "view top | front | right | iso", run: (a) => requestView(String(a?.name ?? "home")) },
  { id: "si", label: "Ask the SI assistant", hint: "? describe a part…", kbd: "I", run: () => setState({ assistantOpen: true }) },
  { id: "new-bracket", label: "New: two-part mounting bracket", run: () => newFrom("bracket") },
  { id: "new-enclosure", label: "New: module enclosure", run: () => newFrom("enclosure") },
  { id: "new-impeller", label: "New: turbine impeller", run: () => newFrom("impeller") },
  { id: "new-plaque", label: "New: plaque with raised text", run: () => newFrom("plaque") },
  planned("sketch", "Create sketch"),
  planned("revolve", "Revolve"),
  planned("sweep", "Sweep"),
  planned("loft", "Loft"),
  planned("pattern", "Pattern"),
  planned("mirror", "Mirror"),
  planned("joint", "Joint"),
  planned("plane", "Offset plane"),
  planned("axis", "Construction axis"),
  planned("measure", "Measure"),
  planned("section", "Section analysis"),
  planned("insert-step", "Insert STEP"),
  planned("drawing", "Engineering drawing"),
];

export const command = (id: string) => COMMANDS.find((c) => c.id === id)!;

export function newFrom(key: keyof typeof SAMPLES) {
  replacePlan(parsePlan(structuredClone(SAMPLES[key])), `New design from template`);
  setState({ project: { id: null, rev: 0, savedHash: null }, validation: null, showHome: false, past: [], future: [] });
}

/**
 * Parse a command-line entry. Forms:
 *   extrude {"distance": 20}     command with JSON arguments
 *   length = 120                 set or add a parameter
 *   view top / export step       command with a word argument
 *   ? anything                   ask the SI assistant
 * Returns a description of what happened, or null when it should go to the assistant.
 */
export function runCommandLine(text: string): { ok: boolean; message: string; askAssistant?: string } {
  const t = text.trim();
  if (!t) return { ok: false, message: "" };
  if (t.startsWith("?")) return { ok: true, message: "Sent to the SI assistant", askAssistant: t.slice(1).trim() };
  const assign = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(t);
  if (assign) {
    const v = Number(assign[2]);
    setParameter(assign[1], Number.isFinite(v) && /^-?[\d.]+$/.test(assign[2].trim()) ? v : assign[2].trim());
    return { ok: true, message: `${assign[1]} = ${assign[2]}` };
  }
  const m = /^([a-z-]+)\s*(.*)$/i.exec(t);
  if (!m) return { ok: false, message: "Not a command" };
  const word = m[1].toLowerCase();
  const rest = m[2].trim();
  if (word === "export") {
    const fmt = rest.toLowerCase();
    const c = fmt === "plan" || fmt === "json" ? command("export-plan") : fmt === "stl" ? command("export-stl") : command("export-step");
    c.run();
    return { ok: true, message: c.label };
  }
  if (word === "view") {
    requestView(rest || "home");
    return { ok: true, message: `View ${rest || "home"}` };
  }
  const c = COMMANDS.find((x) => x.id === word || x.label.toLowerCase() === word);
  if (!c) return { ok: false, message: `Unknown command "${word}". Prefix with ? to ask the SI assistant.`, askAssistant: undefined };
  let args: Record<string, unknown> | undefined;
  if (rest) {
    try {
      args = JSON.parse(rest);
      if (typeof args !== "object" || Array.isArray(args) || args === null) throw new Error();
    } catch {
      return { ok: false, message: `Arguments must be a JSON object, e.g. ${c.hint ?? `${c.id} {}`}` };
    }
  }
  c.run(args);
  return { ok: true, message: c.label };
}
