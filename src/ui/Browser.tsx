// Left "BROWSER" tree: document, views, origin, parameters, bodies and sketches.
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, FileText, Folder, Box, Camera, Axis3d, SquareFunction, PenLine, PanelLeft, Settings } from "lucide-react";
import { commit, requestView, setState, useStore, type Feature } from "../state/store";

function Row({ depth, open, onToggle, icon, label, meta, eye, selected, error, onClick, onDoubleClick, children }: {
  depth: number; open?: boolean; onToggle?: () => void; icon: ReactNode; label: ReactNode; meta?: ReactNode;
  eye?: { on: boolean; toggle: () => void }; selected?: boolean; error?: boolean; onClick?: () => void; onDoubleClick?: () => void; children?: ReactNode;
}) {
  // Keyboard: rows are focusable tree items. Enter/Space activates (Enter twice opens a feature,
  // like a double-click), ArrowRight/ArrowLeft expand and collapse, ArrowUp/ArrowDown move.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (onClick) onClick();
      else onToggle?.();
    } else if (e.key === "ArrowRight" && onToggle && !open) (e.preventDefault(), onToggle());
    else if (e.key === "ArrowLeft" && onToggle && open) (e.preventDefault(), onToggle());
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const rows = [...(e.currentTarget.closest("[role=tree]")?.querySelectorAll<HTMLElement>("[role=treeitem]") ?? [])];
      rows[rows.indexOf(e.currentTarget) + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
    }
  };
  return (
    <>
      <div
        className={`trow ${selected ? "sel" : ""} ${error ? "err" : ""}`}
        style={{ paddingLeft: 4 + depth * 14 }}
        role="treeitem"
        tabIndex={0}
        aria-level={depth + 1}
        aria-expanded={onToggle ? !!open : undefined}
        aria-selected={selected ? true : undefined}
        aria-invalid={error ? true : undefined}
        onClick={onClick ?? onToggle}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      >
        <span className="chev" aria-hidden onClick={(e) => (e.stopPropagation(), onToggle?.())}>{onToggle ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}</span>
        {eye ? (
          <button className={`eye ${eye.on ? "" : "off"}`} aria-pressed={eye.on} aria-label={eye.on ? "Visible — hide" : "Hidden — show"} title={eye.on ? "Hide" : "Show"} onClick={(e) => (e.stopPropagation(), eye.toggle())}>
            {eye.on ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
        ) : null}
        <span aria-hidden>{icon}</span>
        <span className="label">{label}</span>
        {error ? <span className="sr-only">, error</span> : null}
        {meta ? <span className="meta">{meta}</span> : null}
      </div>
      {open && <div role="group">{children}</div>}
    </>
  );
}

const fmtMass = (g: number | null | undefined) => (g == null ? "" : g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${g.toFixed(0)} g`);

export function Browser() {
  const plan = useStore((s) => s.plan);
  const regen = useStore((s) => s.regen);
  const selection = useStore((s) => s.selection);
  const [open, setOpen] = useState<Record<string, boolean>>({ root: true, bodies: true, sketches: false, params: false, views: false, origin: false });
  const t = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const sketches = plan.bodies.flatMap((b) => b.features.filter((f) => f.op === "extrude").map((f) => ({ body: b, f })));
  const allVisible = plan.bodies.every((b) => b.visible);
  const select = (f: Feature) =>
    selection?.kind === "feature" && selection.id === f.id
      ? setState({ editing: f.id, editSnapshot: null })
      : setState({ selection: { kind: "feature", id: f.id }, status: `${f.name ?? f.id} selected — tap again to edit` });
  return (
    <aside className="browser" aria-label="Browser" id="design-browser">
      <div className="panel-head">BROWSER <button className="tb-btn" style={{ width: 20, height: 18 }} title="Hide browser" onClick={() => setState({ browserOpen: false })}><PanelLeft size={12} /></button></div>
      <div className="tree" role="tree" aria-label="Design browser">
        <Row depth={0} open={open.root} onToggle={() => t("root")} eye={{ on: allVisible, toggle: () => commit((p) => p.bodies.forEach((b) => (b.visible = !allVisible)), allVisible ? "All bodies hidden" : "All bodies shown") }}
          icon={<span className="ticon"><FileText size={13} /></span>} label={plan.name}>
          <Row depth={1} icon={<span className="ticon"><Settings size={13} /></span>} label="Document Settings" meta="mm" onClick={() => setState({ status: "Units: millimetres. Tolerance: 0.001 mm" })} />
          <Row depth={1} open={open.views} onToggle={() => t("views")} icon={<span className="ticon folder"><Folder size={13} /></span>} label="Named Views">
            {["home", "top", "front", "right", "iso"].map((v) => (
              <Row key={v} depth={2} icon={<span className="ticon"><Camera size={13} /></span>} label={v[0].toUpperCase() + v.slice(1)} onClick={() => requestView(v)} />
            ))}
          </Row>
          <Row depth={1} open={open.origin} onToggle={() => t("origin")} icon={<span className="ticon folder"><Folder size={13} /></span>} label="Origin">
            {["XY", "XZ", "YZ"].map((p) => <Row key={p} depth={2} icon={<span className="ticon"><Axis3d size={13} /></span>} label={`${p} plane`} />)}
          </Row>
          <Row depth={1} open={open.params} onToggle={() => t("params")} icon={<span className="ticon folder"><Folder size={13} /></span>} label="Parameters" meta={plan.parameters.length} onDoubleClick={() => setState({ dialog: "parameters" })}>
            {plan.parameters.map((p) => (
              <Row key={p.name} depth={2} error={!!regen?.parameterErrors[p.name]} selected={selection?.kind === "parameter" && selection.name === p.name}
                icon={<span className="ticon"><SquareFunction size={13} /></span>} label={p.name}
                meta={p.unit === "text" ? `“${String(p.expr).slice(0, 14)}${String(p.expr).length > 14 ? "…" : ""}”` : regen?.parameters[p.name] !== undefined ? `${+regen.parameters[p.name].toFixed(3)} ${p.unit}` : "—"}
                onClick={() => setState({ selection: { kind: "parameter", name: p.name } })} onDoubleClick={() => setState({ dialog: "parameters" })} />
            ))}
          </Row>
          <Row depth={1} open={open.bodies} onToggle={() => t("bodies")} icon={<span className="ticon folder"><Folder size={13} /></span>} label="Bodies" meta={plan.bodies.length}>
            {plan.bodies.map((b) => {
              const mesh = regen?.bodies.find((x) => x.id === b.id);
              return (
                <Row key={b.id} depth={2} selected={selection?.kind === "body" && selection.id === b.id} error={mesh?.failed}
                  eye={{ on: b.visible, toggle: () => commit((p) => { const x = p.bodies.find((y) => y.id === b.id)!; x.visible = !x.visible; }, `${b.name} ${b.visible ? "hidden" : "shown"}`) }}
                  icon={<span className="swatch" style={{ background: b.color ?? "var(--body-default)" }} />} label={<><Box size={12} style={{ verticalAlign: -2, color: "var(--icon)", marginRight: 4 }} />{b.name}</>}
                  meta={fmtMass(mesh?.massGrams)} onClick={() => setState({ selection: { kind: "body", id: b.id } })} onDoubleClick={() => setState({ dialog: "properties", selection: { kind: "body", id: b.id } })} />
              );
            })}
          </Row>
          <Row depth={1} open={open.sketches} onToggle={() => t("sketches")} icon={<span className="ticon folder"><Folder size={13} /></span>} label="Sketches" meta={sketches.length}>
            {sketches.map(({ body, f }) => (
              <Row key={f.id} depth={2} selected={selection?.kind === "feature" && selection.id === f.id} error={regen?.features[f.id]?.state === "error"}
                icon={<span className="ticon"><PenLine size={12} /></span>} label={`${f.name ?? f.id} profile`} meta={body.name}
                onClick={() => select(f)} onDoubleClick={() => setState({ editing: f.id, editSnapshot: null, selection: { kind: "feature", id: f.id } })} />
            ))}
          </Row>
        </Row>
      </div>
    </aside>
  );
}
