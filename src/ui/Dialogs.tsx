// Floating dialogs: feature editor, parameters, validation report, properties, projects, about.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CircleCheck, CircleX, TriangleAlert, X, ShieldCheck, LoaderCircle, Trash2, Plus, FolderOpen, RefreshCw } from "lucide-react";
import { evaluate } from "../../shared/expr.js";
import {
  commit, deleteFeature, findFeature, getState, listProjects, openProject, runValidation, scheduleRegen, setState, useStore,
  validationState, saveProject, type Feature, type Value,
} from "../state/store";
import { featureIcon } from "./icons";

const NO_PARAMS: Record<string, number> = {};

const MATERIALS = ["Aluminum 6061", "Aluminum 7075", "Steel 1018", "Stainless 316", "Titanium Ti-6Al-4V", "PETG", "PLA", "ABS", "Nylon PA12"];

function Dialog({ title, icon, className = "center", onClose, children, foot }: { title: ReactNode; icon?: ReactNode; className?: string; onClose: () => void; children: ReactNode; foot?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Move focus into the dialog when it opens and give it back when it closes (WCAG 2.4.3).
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(".dialog-body input, .dialog-body select, .dialog-body button, .dialog-foot .btn.primary");
    (first ?? ref.current)?.focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div ref={ref} tabIndex={-1} className={`dialog ${className}`} role="dialog" aria-label={typeof title === "string" ? title : undefined}>
      <div className="dialog-head">{icon}<span className="grow">{title}</span><button className="tb-btn" onClick={onClose} title="Close"><X size={14} /></button></div>
      <div className="dialog-body">{children}</div>
      {foot ? <div className="dialog-foot">{foot}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Expression input: numbers or expressions over parameters, evaluated live.

function useEval(v: Value | undefined) {
  const params = useStore((s) => s.regen?.parameters ?? NO_PARAMS);
  if (v === undefined || v === "") return { text: "", err: null as string | null };
  try {
    const n = evaluate(v, (name: string) => {
      if (name in params) return params[name];
      throw new Error(`unknown parameter "${name}"`);
    });
    return { text: typeof v === "number" ? "" : `= ${+n.toFixed(4)}`, err: null };
  } catch (e: any) {
    return { text: "", err: e.message as string };
  }
}

const toValue = (s: string): Value => (/^\s*-?\d+(\.\d+)?\s*$/.test(s) ? parseFloat(s) : s.trim());

function ExprField({ label, value, onChange, unit = "mm", optional }: { label: string; value: Value | undefined; onChange: (v: Value | undefined) => void; unit?: string; optional?: boolean }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => {
    setText(value === undefined ? "" : String(value));
  }, [value]);
  const { text: hint, err } = useEval(value);
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} value={text} placeholder={optional ? "through" : ""} spellCheck={false} aria-invalid={err ? true : undefined} aria-describedby={err || hint ? `${id}-hint` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() === "") return optional ? onChange(undefined) : undefined;
          onChange(toValue(e.target.value));
        }} />
      {err ? <span id={`${id}-hint`} className="hint err" role="alert">{err}</span> : hint ? <span id={`${id}-hint`} className="hint">{hint} {unit}</span> : null}
    </div>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o}>{o}</option>)}</select>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Feature dialog (opens on add, double-click in the timeline, or from the browser)

export function FeatureDialog() {
  const editing = useStore((s) => s.editing);
  const plan = useStore((s) => s.plan);
  const fstate = useStore((s) => (s.editing ? s.regen?.features[s.editing] : undefined));
  useEffect(() => {
    if (editing && !getState().editSnapshot) setState({ editSnapshot: getState().plan });
  }, [editing]);
  if (!editing) return null;
  const hit = findFeature(plan, editing);
  if (!hit) return null;
  const f = hit.feature;
  const set = (patch: (x: Feature) => void) =>
    commit((p) => patch(findFeature(p, editing)!.feature), undefined, { history: false });
  const ok = () => {
    const { editSnapshot, past } = getState();
    setState({ editing: null, editSnapshot: null, past: editSnapshot && editSnapshot !== getState().plan ? [...past.slice(-99), editSnapshot] : past, future: [], status: `${f.name ?? f.id} applied` });
  };
  const cancel = () => {
    const { editSnapshot } = getState();
    setState({ editing: null, editSnapshot: null, ...(editSnapshot ? { plan: editSnapshot } : {}), status: "Edit cancelled" });
    scheduleRegen(0);
  };
  const Icon = featureIcon(f);
  return (
    <Dialog className="feature" title={`${f.op[0].toUpperCase()}${f.op.slice(1)} · ${hit.body.name}`} icon={<Icon size={15} color="var(--icon)" />} onClose={cancel}
      foot={<>
        <button className="btn ghost danger" title="Delete feature" onClick={() => deleteFeature(f.id)}><Trash2 size={13} /></button>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={cancel}>Cancel</button>
        <button className="btn primary" onClick={ok}>OK</button>
      </>}>
      <div className="field"><label htmlFor="feature-name">Name</label><input id="feature-name" value={f.name ?? ""} onChange={(e) => set((x) => (x.name = e.target.value))} /></div>
      {f.op === "extrude" && <ExtrudeFields f={f} set={set} />}
      {f.op === "hole" && <HoleFields f={f} set={set} />}
      {f.op === "fillet" && <>
        <ExprField label="Radius" value={f.radius} onChange={(v) => set((x) => (x.radius = v))} />
        <EdgesField value={f.edges} set={set} options={["vertical", "top", "bottom", "all"]} />
      </>}
      {f.op === "chamfer" && <>
        <ExprField label="Distance" value={f.distance} onChange={(v) => set((x) => (x.distance = v))} />
        <EdgesField value={f.edges} set={set} options={["top", "bottom", "vertical", "all"]} />
      </>}
      {f.op === "shell" && <>
        <ExprField label="Thickness" value={f.thickness} onChange={(v) => set((x) => (x.thickness = v))} />
        <Select label="Open face" value={f.openFace} options={["top", "bottom", "front", "back", "left", "right"]} onChange={(v) => set((x) => (x.openFace = v))} />
      </>}
      <label className="check"><input type="checkbox" checked={!!f.suppressed} onChange={(e) => set((x) => (x.suppressed = e.target.checked))} /> Suppressed</label>
      {fstate?.state === "error" ? <div className="msg err">{fstate.message}</div> : null}
      {fstate?.state === "skipped" ? <div className="msg warn">{fstate.message}</div> : null}
      {fstate?.note ? <div className="msg info">{fstate.note}</div> : null}
      <div className="msg info">Values accept parameter expressions, e.g. <code>length / 2 - 8</code>.</div>
    </Dialog>
  );
}

function EdgesField({ value, set, options }: { value: any; set: (p: (x: Feature) => void) => void; options: string[] }) {
  const byDiameter = value && typeof value === "object";
  return (
    <>
      <Select label="Edges" value={byDiameter ? "circle of diameter" : value} options={[...options, "circle of diameter"]}
        onChange={(v) => set((x) => (x.edges = v === "circle of diameter" ? { diameter: 10 } : v))} />
      {byDiameter && <ExprField label="Diameter" value={value.diameter} onChange={(v) => set((x) => (x.edges = { diameter: v ?? 1 }))} />}
    </>
  );
}

function TextFields({ p, set }: { p: any; set: (fn: (x: Feature) => void) => void }) {
  const allParams = useStore((s) => s.plan.parameters);
  const textParams = allParams.filter((q) => q.unit === "text");
  const linked = textParams.find((q) => q.name === p.text);
  const id = useId();
  return (
    <>
      <div className="field">
        <label htmlFor={id}>Text</label>
        {linked ? (
          <input id={id} value={String(linked.expr)} aria-describedby={`${id}-hint`}
            onChange={(e) => commit((x) => (x.parameters.find((q) => q.name === linked.name)!.expr = e.target.value), undefined, { history: false })} />
        ) : (
          <input id={id} value={p.text} onChange={(e) => set((x) => (x.profile.text = e.target.value || " "))} />
        )}
        <span id={`${id}-hint`} className="hint">{linked ? <>from parameter <code>{linked.name}</code></> : "literal text"}</span>
      </div>
      <ExprField label="Font size" value={p.size} onChange={(v) => set((x) => (x.profile.size = v ?? 8))} />
      <Select label="Font" value={p.font ?? "sans-bold"} options={["sans-bold", "sans", "mono"]} onChange={(v) => set((x) => (x.profile.font = v))} />
    </>
  );
}

function ExtrudeFields({ f, set }: { f: Feature; set: (p: (x: Feature) => void) => void }) {
  const p = f.profile;
  return (
    <>
      <div className="section-label">PROFILE</div>
      <Select label="Shape" value={p.type} options={["rect", "circle", "slot", "ring", "text"]} onChange={(t) => set((x) => (x.profile = t === "rect" ? { type: "rect", width: 20, height: 20 } : t === "circle" ? { type: "circle", diameter: 20 } : t === "ring" ? { type: "ring", outer: 30, inner: 20 } : t === "text" ? { type: "text", text: "TEXT", size: 8, font: "sans-bold" } : { type: "slot", length: 30, width: 8 }))} />
      {p.type === "rect" && <>
        <ExprField label="Width" value={p.width} onChange={(v) => set((x) => (x.profile.width = v))} />
        <ExprField label="Height" value={p.height} onChange={(v) => set((x) => (x.profile.height = v))} />
        <ExprField label="Corner radius" value={p.cornerRadius} optional onChange={(v) => set((x) => (v === undefined ? delete x.profile.cornerRadius : (x.profile.cornerRadius = v)))} />
      </>}
      {p.type === "circle" && <ExprField label="Diameter" value={p.diameter} onChange={(v) => set((x) => (x.profile.diameter = v))} />}
      {p.type === "text" && <TextFields p={p} set={set} />}
      {p.type === "ring" && <>
        <ExprField label="Outer diameter" value={p.outer} onChange={(v) => set((x) => (x.profile.outer = v))} />
        <ExprField label="Inner diameter" value={p.inner} onChange={(v) => set((x) => (x.profile.inner = v))} />
      </>}
      {p.type === "slot" && <>
        <ExprField label="Length" value={p.length} onChange={(v) => set((x) => (x.profile.length = v))} />
        <ExprField label="Width" value={p.width} onChange={(v) => set((x) => (x.profile.width = v))} />
      </>}
      <Select label="Plane" value={f.plane} options={["XY", "XZ", "YZ"]} onChange={(v) => set((x) => (x.plane = v))} />
      <ExprField label="Centre U" value={f.at[0]} onChange={(v) => set((x) => (x.at = [v ?? 0, x.at[1]]))} />
      <ExprField label="Centre V" value={f.at[1]} onChange={(v) => set((x) => (x.at = [x.at[0], v ?? 0]))} />
      <ExprField label="Plane offset" value={f.offset} onChange={(v) => set((x) => (x.offset = v ?? 0))} />
      <div className="section-label">EXTENT</div>
      <ExprField label="Distance" value={f.distance} onChange={(v) => set((x) => (x.distance = v))} />
      <label className="check"><input type="checkbox" checked={!!f.symmetric} onChange={(e) => set((x) => (x.symmetric = e.target.checked))} /> Symmetric about the plane</label>
      <ExprField label="Twist" unit="°" optional value={f.twist} onChange={(v) => set((x) => (v === undefined ? delete x.twist : (x.twist = v)))} />
      <label className="check"><input type="checkbox" checked={!!f.circular} onChange={(e) => set((x) => (e.target.checked ? (x.circular = { count: 6 }) : delete x.circular))} /> Circular pattern about Z</label>
      {f.circular && <>
        <ExprField label="Count" unit="" value={f.circular.count} onChange={(v) => set((x) => (x.circular.count = v ?? 1))} />
        <ExprField label="Start angle" unit="°" optional value={f.circular.startAngle} onChange={(v) => set((x) => (v === undefined ? delete x.circular.startAngle : (x.circular.startAngle = v)))} />
      </>}
      <Select label="Operation" value={f.mode} options={["new", "join", "cut"]} onChange={(v) => set((x) => (x.mode = v))} />
    </>
  );
}

function HoleFields({ f, set }: { f: Feature; set: (p: (x: Feature) => void) => void }) {
  const positions = (f.positions ?? []).map((p: Value[]) => p.join(", ")).join("; ");
  const [posText, setPosText] = useState(positions);
  useEffect(() => {
    setPosText(positions);
  }, [f.id]);
  return (
    <>
      <Select label="Face" value={f.face} options={["top", "bottom", "front", "back", "left", "right"]} onChange={(v) => set((x) => (x.face = v))} />
      <ExprField label="Diameter" value={f.diameter} onChange={(v) => set((x) => (x.diameter = v))} />
      <ExprField label="Depth" value={f.depth} optional onChange={(v) => set((x) => (v === undefined ? delete x.depth : (x.depth = v)))} />
      <div className="field">
        <label htmlFor="hole-positions">Positions</label>
        <input id="hole-positions" aria-describedby="hole-positions-hint" value={posText} spellCheck={false} placeholder="u, v; u, v" onChange={(e) => {
          setPosText(e.target.value);
          const pts = e.target.value.split(";").map((s) => s.split(",").map((t) => t.trim())).filter((a) => a.length === 2 && a[0] && a[1]).map(([u, v]) => [toValue(u), toValue(v)]);
          set((x) => (pts.length ? (x.positions = pts) : delete x.positions));
        }} />
        <span id="hole-positions-hint" className="hint">relative to the face centre; empty = centre</span>
      </div>
      <label className="check"><input type="checkbox" checked={!!f.pattern} onChange={(e) => set((x) => (e.target.checked ? (x.pattern = { countX: 2, countY: 2, spacingX: 20, spacingY: 20 }) : delete x.pattern))} /> Rectangular pattern</label>
      {f.pattern && <div className="field-row">
        <ExprField label="Count U" unit="" value={f.pattern.countX} onChange={(v) => set((x) => (x.pattern.countX = v ?? 1))} />
        <ExprField label="Count V" unit="" value={f.pattern.countY} onChange={(v) => set((x) => (x.pattern.countY = v ?? 1))} />
        <ExprField label="Spacing U" value={f.pattern.spacingX} onChange={(v) => set((x) => (x.pattern.spacingX = v ?? 0))} />
        <ExprField label="Spacing V" value={f.pattern.spacingY} onChange={(v) => set((x) => (x.pattern.spacingY = v ?? 0))} />
      </div>}
      <label className="check"><input type="checkbox" checked={!!f.circular} onChange={(e) => set((x) => (e.target.checked ? (x.circular = { count: 6, diameter: 40 }) : delete x.circular))} /> Bolt circle</label>
      {f.circular && <>
        <ExprField label="Count" unit="" value={f.circular.count} onChange={(v) => set((x) => (x.circular.count = v ?? 1))} />
        <ExprField label="Circle diameter" value={f.circular.diameter} onChange={(v) => set((x) => (x.circular.diameter = v))} />
        <ExprField label="Start angle" unit="°" optional value={f.circular.startAngle} onChange={(v) => set((x) => (v === undefined ? delete x.circular.startAngle : (x.circular.startAngle = v)))} />
      </>}
      <label className="check"><input type="checkbox" checked={!!f.countersink} onChange={(e) => set((x) => (e.target.checked ? (x.countersink = { diameter: "2 * 6", angle: 90 }) : delete x.countersink))} /> Countersink</label>
      {f.countersink && <>
        <ExprField label="CSK diameter" value={f.countersink.diameter} onChange={(v) => set((x) => (x.countersink.diameter = v))} />
        <ExprField label="CSK angle" unit="°" value={f.countersink.angle} onChange={(v) => set((x) => (x.countersink.angle = v ?? 90))} />
      </>}
    </>
  );
}

// ---------------------------------------------------------------------------------------------

export function ParametersDialog() {
  const plan = useStore((s) => s.plan);
  const regen = useStore((s) => s.regen);
  const [newName, setNewName] = useState("");
  const close = () => setState({ dialog: null });
  const used = (name: string) => JSON.stringify(plan.bodies).match(new RegExp(`\\b${name}\\b`, "g"))?.length ?? 0;
  return (
    <Dialog title="Parameters" icon={<span style={{ color: "var(--icon)", fontWeight: 700 }}>fx</span>} onClose={close}
      foot={<>
        <input aria-label="New parameter name" placeholder="new_parameter" value={newName} onChange={(e) => setNewName(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))} style={{ height: 24, padding: "0 6px", width: 160 }} />
        <button className="btn" disabled={!/^[A-Za-z_]\w*$/.test(newName) || plan.parameters.some((p) => p.name === newName)} onClick={() => (commit((p) => p.parameters.push({ name: newName, expr: 10, unit: "mm" }), `Added ${newName}`), setNewName(""))}><Plus size={13} /> Add</button>
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={close}>Done</button>
      </>}>
      <table className="grid">
        <thead><tr><th style={{ width: "22%" }}>NAME</th><th>EXPRESSION</th><th style={{ width: 90, textAlign: "right" }}>VALUE</th><th style={{ width: 40 }}>UNIT</th><th style={{ width: "30%" }}>DESCRIPTION</th><th style={{ width: 28 }} /></tr></thead>
        <tbody>
          {plan.parameters.map((p, i) => {
            const err = regen?.parameterErrors[p.name];
            return (
              <tr key={p.name} className={err ? "err" : ""} title={err}>
                <td style={{ fontFamily: "var(--font-mono)" }}>{p.name}</td>
                <td><ParamExpr label={`${p.name} ${p.unit === "text" ? "text" : "expression"}`} literal={p.unit === "text"} value={p.expr} onChange={(v) => commit((x) => (x.parameters[i].expr = v), `${p.name} = ${JSON.stringify(v)}`)} /></td>
                <td className="num">{p.unit === "text" ? "text" : err ? "error" : regen?.parameters[p.name] !== undefined ? +regen.parameters[p.name].toFixed(4) : "…"}</td>
                <td style={{ color: "var(--text-muted)" }}>{p.unit}</td>
                <td><input aria-label={`${p.name} description`} value={p.description ?? ""} onChange={(e) => commit((x) => (x.parameters[i].description = e.target.value), undefined, { history: false })} /></td>
                <td><button className="tb-btn" aria-label={`Delete ${p.name}`} title={used(p.name) ? `Used ${used(p.name)}× — cannot delete` : "Delete"} disabled={used(p.name) > 0} onClick={() => commit((x) => x.parameters.splice(i, 1), `Deleted ${p.name}`)}><Trash2 size={13} /></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {Object.keys(regen?.parameterErrors ?? {}).length ? <div className="msg err">{Object.entries(regen!.parameterErrors).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div> : null}
      <div className="msg info">Expressions may reference other parameters with + − × ÷ and parentheses. Changes regenerate the model immediately and reset validation.</div>
    </Dialog>
  );
}

function ParamExpr({ value, onChange, label, literal }: { value: Value; onChange: (v: Value) => void; label: string; literal?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);
  // Text parameters keep exactly what was typed (including digits); others parse as number or expression.
  const commitText = () => text.trim() && String(value) !== text.trim() && onChange(literal ? text.trim() : toValue(text));
  return <input aria-label={label} value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} onBlur={commitText} onKeyDown={(e) => e.key === "Enter" && commitText()} />;
}

// ---------------------------------------------------------------------------------------------

const CheckIcon = ({ s }: { s: string }) => (s === "pass" ? <CircleCheck size={15} color="var(--ok)" /> : s === "warn" ? <TriangleAlert size={15} color="var(--warn)" /> : <CircleX size={15} color="var(--error)" />);

export function ValidationDialog() {
  const validation = useStore((s) => s.validation);
  const validating = useStore((s) => s.validating);
  const vstate = useStore(validationState);
  const close = () => setState({ dialog: null });
  return (
    <Dialog title="Engineering checks" icon={<ShieldCheck size={15} color="var(--icon)" />} onClose={close}
      foot={<>
        <span style={{ flex: 1, color: "var(--text-faint)", fontSize: 11 }}>{validation ? `Plan ${validation.planHash.slice(0, 12)}… · ${new Date(validation.at).toLocaleString()}` : ""}</span>
        <button className="btn" onClick={close}>Close</button>
        <button className="btn primary" disabled={validating} onClick={runValidation}>{validating ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />} Run checks</button>
      </>}>
      {vstate === "stale" ? <div className="msg warn">The design changed after these checks ran. Status is unverified until checks run again.</div> : null}
      {!validation ? <div className="msg info">No checks have run on this design. Generated and edited models stay <b>unverified</b> until every check passes.</div> : null}
      {validation?.checks.map((c) => (
        <div className="check-row" key={c.id}><CheckIcon s={c.status} /><div><div>{c.label}</div><div className="detail">{c.detail}</div></div></div>
      ))}
      <div className="msg info">These are deterministic geometry checks ({validation?.kernel ?? "Open CASCADE"}). They are not engineering approval: models are not certified for flight or safety-critical use until reviewed under the applicable technical authority.</div>
    </Dialog>
  );
}

export function PropertiesDialog() {
  const regen = useStore((s) => s.regen);
  const plan = useStore((s) => s.plan);
  const close = () => setState({ dialog: null });
  return (
    <Dialog title="Properties" onClose={close} foot={<button className="btn primary" onClick={close}>Close</button>}>
      <table className="grid">
        <thead><tr><th>BODY</th><th>MATERIAL</th><th style={{ textAlign: "right" }}>VOLUME</th><th style={{ textAlign: "right" }}>AREA</th><th style={{ textAlign: "right" }}>MASS</th><th style={{ textAlign: "right" }}>SIZE (X × Y × Z)</th><th style={{ textAlign: "right" }}>FACES</th></tr></thead>
        <tbody>
          {plan.bodies.map((b, i) => {
            const m = regen?.bodies.find((x) => x.id === b.id);
            return (
              <tr key={b.id}>
                <td><span className="swatch" style={{ background: b.color, display: "inline-block", marginRight: 6 }} />{b.name}</td>
                <td><select aria-label={`${b.name} material`} value={b.material ?? ""} style={{ height: 22 }} onChange={(e) => commit((p) => (p.bodies[i].material = e.target.value), `${b.name}: ${e.target.value}`)}><option value="">—</option>{MATERIALS.map((x) => <option key={x}>{x}</option>)}</select></td>
                <td className="num">{m && !m.empty ? `${(m.volume / 1000).toFixed(2)} cm³` : "—"}</td>
                <td className="num">{m && !m.empty ? `${(m.area / 100).toFixed(1)} cm²` : "—"}</td>
                <td className="num">{m?.massGrams != null ? `${m.massGrams.toFixed(1)} g` : "—"}</td>
                <td className="num">{m && !m.empty ? m.bounds.size.map((v) => v.toFixed(1)).join(" × ") : "—"}</td>
                <td className="num">{m && !m.empty ? m.faces : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="msg info">Mass uses nominal densities; it is an estimate, not a weight-and-balance figure.</div>
    </Dialog>
  );
}

export function ProjectsDialog() {
  const [items, setItems] = useState<Awaited<ReturnType<typeof listProjects>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const storage = useStore((s) => s.config?.storage);
  const close = () => setState({ dialog: null });
  useEffect(() => {
    listProjects().then(setItems, (e) => setError(e.message));
  }, []);
  return (
    <Dialog title="Projects" icon={<FolderOpen size={15} color="var(--icon)" />} onClose={close}
      foot={<><span style={{ flex: 1, color: "var(--text-faint)", fontSize: 11 }}>Storage: {storage?.location ?? "…"}</span><button className="btn" onClick={() => saveProject()}>Save current</button><button className="btn primary" onClick={close}>Close</button></>}>
      {storage?.backend === "local" ? <div className="msg warn">Projects are stored on the app container, which is not durable in a deployed Databricks App. Bind a Unity Catalog Volume (PROJECTS_VOLUME) for real use.</div> : null}
      {error ? <div className="msg err">{error}</div> : null}
      {!items && !error ? <div className="msg info"><LoaderCircle size={12} className="spin" /> Loading…</div> : null}
      {items?.length === 0 ? <div className="msg info">No saved projects yet. Save a revision with Ctrl+S.</div> : null}
      {items?.length ? (
        <table className="grid"><thead><tr><th>NAME</th><th>OWNER</th><th>REVISIONS</th><th>STATUS</th><th>UPDATED</th></tr></thead>
          <tbody>{items.map((p) => (
            <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => openProject(p.id)}>
              <td>{p.name}</td><td style={{ color: "var(--text-muted)" }}>{p.owner}</td><td className="num">{p.revisions}</td>
              <td style={{ color: p.validation === "validated" ? "var(--ok)" : "var(--warn)" }}>{p.validation}</td>
              <td style={{ color: "var(--text-muted)" }}>{p.updatedAt ? new Date(p.updatedAt).toLocaleString() : ""}</td>
            </tr>))}</tbody></table>
      ) : null}
    </Dialog>
  );
}

export function AboutDialog() {
  const config = useStore((s) => s.config);
  const close = () => setState({ dialog: null });
  return (
    <Dialog title="About CAD Workbench" onClose={close} foot={<button className="btn primary" onClick={close}>Close</button>}>
      <div><b>CAD Workbench</b> — SI-assisted parametric CAD. Version {config?.version}. Feasibility spike.</div>
      <div className="msg info">
        Geometry: Open CASCADE (via replicad, LGPL-2.1) compiled to WebAssembly, running in your browser. Planner: {config?.si.configured ? `Model Serving endpoint ${config.si.endpoint}` : "offline template planner (no model endpoint configured)"}. Storage: {config?.storage.location}.
      </div>
      <div className="section-label">MOUSE &amp; KEYS</div>
      <div style={{ color: "var(--text-muted)" }}>Orbit: left drag · Pan: right or middle drag · Zoom: wheel · Fit: double-click · S: command search · E/H/F: extrude/hole/fillet · P: parameters · V: validate · Ctrl+Z/Y: undo/redo · Ctrl+S: save · Del: delete feature · Esc: clear selection</div>
      <div className="section-label">LIMITS OF THIS BUILD</div>
      <div style={{ color: "var(--text-muted)" }}>No interactive sketcher yet (profiles are rectangles, circles and slots); no drawings; validation runs on the same kernel that built the model. See the repository's docs for the roadmap.</div>
    </Dialog>
  );
}
