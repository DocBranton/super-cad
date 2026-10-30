// Title bar and ribbon — the top of the look-and-feel contract.
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Box, Boxes, ChevronDown, CircleHelp, Combine, Download, FileDown, FileInput, FolderOpen, Grid3x3, House, Info,
  Layers3, MousePointer2, Plus, Redo2, Ruler, Save, ScanSearch, Settings, ShieldCheck, Slice, Sparkles, SquareFunction,
  Trash2, Undo2, Upload, X, Axis3d, SquareDashed, Focus, type LucideIcon,
} from "lucide-react";
import { COMMANDS, command } from "../commands";
import { setState, useStore, validationState } from "../state/store";
import { AppMark, OP_ICON } from "./icons";

// ---------------------------------------------------------------------------------------------
// Menus

type MenuItem = { id: string; icon?: LucideIcon } | "sep";

export function Menu({ at, items, onClose }: { at: { x: number; y: number }; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Focus the first item on open, arrow keys move between items, focus returns to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => (e.preventDefault(), list[(n + list.length) % list.length]?.focus());
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Tab") onClose();
  };
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    setTimeout(() => window.addEventListener("mousedown", close));
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  return (
    <div className="menu" ref={ref} style={{ left: Math.min(at.x, window.innerWidth - 240), top: at.y }} role="menu" onKeyDown={onKeyDown}>
      {items.map((it, i) => {
        if (it === "sep") return <hr key={i} />;
        const c = command(it.id);
        const Icon = it.icon;
        return (
          <button key={it.id} role="menuitem" tabIndex={-1} aria-disabled={c.planned ? true : undefined} onClick={() => (onClose(), c.run())} title={c.planned ? "Planned — not part of this spike" : c.hint}>
            {Icon ? <Icon size={15} /> : <span style={{ width: 15 }} />}
            <span>{c.label}</span>
            <span className="kbd">{c.planned ? "planned" : c.kbd ?? ""}</span>
          </button>
        );
      })}
    </div>
  );
}

function useMenu() {
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
  const open = (e: React.MouseEvent, items: MenuItem[]) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ at: { x: r.left, y: r.bottom + 2 }, items });
  };
  const node = menu ? <Menu at={menu.at} items={menu.items} onClose={() => setMenu(null)} /> : null;
  return { open, node };
}

// ---------------------------------------------------------------------------------------------
// Title bar

export function TitleBar() {
  const name = useStore((s) => s.plan.name);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const vstate = useStore(validationState);
  const config = useStore((s) => s.config);
  const project = useStore((s) => s.project);
  const dirty = useStore((s) => s.project.savedHash !== s.currentHash);
  const showHome = useStore((s) => s.showHome);
  const { open, node } = useMenu();
  const label = { validated: "VALIDATED", failed: "CHECKS FAILED", unverified: "UNVERIFIED", stale: "UNVERIFIED — CHANGED" }[vstate];
  return (
    <header className="titlebar">
      <a className="skip-link" href="#design-browser" onClick={(e) => { e.preventDefault(); setState({ browserOpen: true }); setTimeout(() => document.querySelector<HTMLElement>("#design-browser [role=treeitem]")?.focus(), 50); }}>Skip to design</a>
      <div className="app-mark"><AppMark /> <span>CAD Workbench</span></div>
      <button className="tb-btn" title="New" onClick={(e) => open(e, [{ id: "new-bracket", icon: Boxes }, { id: "new-enclosure", icon: Box }])}><Plus size={15} /></button>
      <button className="tb-btn" title="Open project (Ctrl+O)" onClick={() => setState({ dialog: "projects" })}><FolderOpen size={15} /></button>
      <button className="tb-btn" title="Save revision (Ctrl+S)" onClick={() => command("save").run()}><Save size={15} /></button>
      <button className="tb-btn" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => command("undo").run()}><Undo2 size={15} /></button>
      <button className="tb-btn" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={() => command("redo").run()}><Redo2 size={15} /></button>
      <button className="tb-btn" title="Export" onClick={(e) => open(e, [{ id: "export-step", icon: FileDown }, { id: "export-stl", icon: Download }, { id: "export-plan", icon: Upload }])}><Download size={15} /></button>
      <div className="doc-tabs">
        <button className={`doc-tab ${showHome ? "active" : ""}`} aria-current={showHome ? "page" : undefined} onClick={() => setState({ showHome: true })}><House size={13} /> <span>Home</span></button>
        <div className={`doc-tab ${showHome ? "" : "active"}`}>
          <button className="tab-label" aria-current={showHome ? undefined : "page"} title={name} onClick={() => setState({ showHome: false })}>
            <span>{name}{project.id ? ` · v${project.rev}` : ""}{dirty && project.id ? " •" : ""}</span>
          </button>
          <button className="x" aria-label="Close design and go to Home" title="Close (back to Home)" onClick={() => setState({ showHome: true })}><X size={12} /></button>
        </div>
        <button className="doc-tab" aria-label="New design" title="New design" onClick={(e) => open(e, [{ id: "new-bracket", icon: Boxes }, { id: "new-enclosure", icon: Box }])}><Plus size={13} /></button>
      </div>
      <div className="tb-spacer" />
      <button className={`status-chip ${vstate}`} title="Engineering status — click for the validation report" onClick={() => setState({ dialog: "validation" })}>
        <ShieldCheck size={12} /> {label}
      </button>
      <div className="tb-sep" />
      <button className="tb-text-btn" aria-label="Help" title="About this build" onClick={() => setState({ dialog: "about" })}><CircleHelp size={13} /> <span>Help</span></button>
      <button className="tb-btn" title="Settings: service theme" onClick={(e) => open(e, [{ id: "theme-air-force" }, { id: "theme-army" }, { id: "theme-navy" }, { id: "theme-marine-corps" }])}><Settings size={15} /></button>
      <span className="pill" title={config ? `${config.user} · storage: ${config.storage.backend}` : ""}>v{config?.version ?? "…"}</span>
      {node}
    </header>
  );
}

// Theme commands live with the title bar that offers them.
for (const [id, label] of [["air-force", "U.S. Air Force"], ["army", "U.S. Army"], ["navy", "U.S. Navy"], ["marine-corps", "U.S. Marine Corps"]] as const)
  COMMANDS.push({ id: `theme-${id}`, label: `Theme: ${label}`, run: () => { document.documentElement.dataset.theme = id; setState({ status: `Theme: ${label}` }); } });

// ---------------------------------------------------------------------------------------------
// Ribbon

type Tool = { id: string; icon: LucideIcon; alt?: boolean };
type Group = { label: string; tools: Tool[]; menu?: MenuItem[] };

const SOLID: Group[] = [
  { label: "CREATE", tools: [{ id: "body", icon: OP_ICON.body }, { id: "sketch", icon: OP_ICON.sketch }, { id: "extrude", icon: OP_ICON.extrude }, { id: "hole", icon: OP_ICON.hole }],
    menu: [{ id: "body", icon: OP_ICON.body }, { id: "sketch", icon: OP_ICON.sketch }, "sep", { id: "extrude", icon: OP_ICON.extrude }, { id: "revolve" }, { id: "sweep" }, { id: "loft" }, "sep", { id: "hole", icon: OP_ICON.hole }, { id: "pattern" }, { id: "mirror" }] },
  { label: "MODIFY", tools: [{ id: "fillet", icon: OP_ICON.fillet }, { id: "chamfer", icon: OP_ICON.chamfer }, { id: "shell", icon: OP_ICON.shell }, { id: "delete", icon: Trash2 }],
    menu: [{ id: "fillet", icon: OP_ICON.fillet }, { id: "chamfer", icon: OP_ICON.chamfer }, { id: "shell", icon: OP_ICON.shell }, "sep", { id: "parameters", icon: SquareFunction }, { id: "delete", icon: Trash2 }] },
  { label: "ASSEMBLE", tools: [{ id: "body", icon: Boxes }, { id: "interference", icon: Combine }], menu: [{ id: "body", icon: Boxes }, { id: "joint" }, { id: "interference", icon: Combine }] },
  { label: "CONFIGURE", tools: [{ id: "parameters", icon: SquareFunction }], menu: [{ id: "parameters", icon: SquareFunction }] },
  { label: "CONSTRUCT", tools: [{ id: "plane", icon: SquareDashed }, { id: "axis", icon: Axis3d }], menu: [{ id: "plane", icon: SquareDashed }, { id: "axis", icon: Axis3d }] },
  { label: "INSPECT", tools: [{ id: "properties", icon: Info }, { id: "validate", icon: ShieldCheck }, { id: "measure", icon: Ruler }, { id: "section", icon: Slice }],
    menu: [{ id: "properties", icon: Info }, { id: "validate", icon: ShieldCheck }, { id: "interference", icon: Combine }, { id: "measure", icon: Ruler }, { id: "section", icon: Slice }] },
  { label: "INSERT", tools: [{ id: "si", icon: Sparkles, alt: true }, { id: "insert-step", icon: FileInput }], menu: [{ id: "si", icon: Sparkles }, { id: "insert-step", icon: FileInput }, { id: "drawing" }] },
  { label: "SELECT", tools: [{ id: "select", icon: MousePointer2 }] },
];

const UTILITIES: Group[] = [
  { label: "PROJECT", tools: [{ id: "open", icon: FolderOpen }, { id: "save", icon: Save }], menu: [{ id: "open", icon: FolderOpen }, { id: "save", icon: Save }] },
  { label: "EXPORT", tools: [{ id: "export-step", icon: FileDown }, { id: "export-stl", icon: Download }, { id: "export-plan", icon: Upload }], menu: [{ id: "export-step", icon: FileDown }, { id: "export-stl", icon: Download }, { id: "export-plan", icon: Upload }] },
  { label: "VIEW", tools: [{ id: "fit", icon: Focus }, { id: "view", icon: ScanSearch }] },
  { label: "SETTINGS", tools: [{ id: "theme-air-force", icon: Grid3x3 }], menu: [{ id: "theme-air-force" }, { id: "theme-army" }, { id: "theme-navy" }, { id: "theme-marine-corps" }] },
];

const TABS = ["SOLID", "SURFACE", "MESH", "SHEET METAL", "PLASTIC", "UTILITIES"];

COMMANDS.push({ id: "select", label: "Select", kbd: "Esc", run: () => setState({ selection: null, editing: null }) });

function ToolButton({ tool }: { tool: Tool }) {
  const c = command(tool.id);
  const Icon = tool.icon;
  return (
    <button className={`rtool ${tool.alt ? "alt" : ""}`} onClick={() => c.run()} title={`${c.label}${c.kbd ? ` (${c.kbd})` : ""}${c.planned ? " — planned" : ""}`} aria-label={c.planned ? `${c.label} (planned, not available)` : c.label} aria-disabled={c.planned ? true : undefined} style={c.planned ? { opacity: 0.45 } : undefined}>
      <Icon size={20} strokeWidth={1.7} />
    </button>
  );
}

export function Ribbon() {
  const tab = useStore((s) => s.ribbonTab);
  const { open, node } = useMenu();
  const groups = tab === "SOLID" ? SOLID : tab === "UTILITIES" ? UTILITIES : null;
  return (
    <div className="ribbon" role="region" aria-label="Ribbon">
      <button className="workspace-switch" title="Workspace" onClick={(e) => open(e, [{ id: "si", icon: Sparkles }, { id: "drawing" }])}>
        <span className="ws-icon"><Layers3 size={20} /></span>
        <span className="ws-name">DESIGN <ChevronDown size={11} /></span>
        <span className="ws-sub">workspace</span>
      </button>
      <div className="ribbon-main">
        <div className="ribbon-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`ribbon-tab ${tab === t ? "active" : ""}`} onClick={() => setState({ ribbonTab: t })}>{t}</button>
          ))}
        </div>
        <div className="ribbon-groups">
          {groups ? groups.map((g) => (
            <div className="rgroup" key={g.label}>
              <div className="rgroup-tools">{g.tools.map((t) => <ToolButton key={t.id + g.label} tool={t} />)}</div>
              <button className="rgroup-label" aria-haspopup={g.menu ? "menu" : undefined} onClick={(e) => g.menu && open(e, g.menu)}>{g.label}{g.menu ? <ChevronDown size={10} /> : null}</button>
            </div>
          )) : <RibbonPlanned tab={tab} />}
        </div>
      </div>
      {node}
    </div>
  );
}

function RibbonPlanned({ tab }: { tab: string }): ReactNode {
  return <div className="ribbon-note">{tab.charAt(0) + tab.slice(1).toLowerCase()} tools are planned. This spike covers the Solid workspace.</div>;
}
