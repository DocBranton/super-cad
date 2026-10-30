// Command line, status and the parametric timeline along the bottom edge.
import { useEffect, useMemo, useRef, useState } from "react";
import { SkipBack, SkipForward, StepBack, StepForward, Settings } from "lucide-react";
import { COMMANDS, runCommandLine } from "../commands";
import { askAssistant, scheduleRegen, setState, timelineOf, useStore, getState, deleteFeature, commit } from "../state/store";
import { featureIcon } from "./icons";
import { Menu } from "./Chrome";

export function CommandBar() {
  const status = useStore((s) => s.status);
  const user = useStore((s) => s.config?.user);
  const storage = useStore((s) => s.config?.storage.backend);
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(false);
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const history = useRef<string[]>([]);
  const hpos = useRef(-1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if ((e.key === "s" || e.key === "S") && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const word = text.trim().split(/\s/)[0]?.toLowerCase() ?? "";
  const matches = useMemo(
    () => (focus && text && !text.includes(" ") && !text.startsWith("?") ? COMMANDS.filter((c) => !c.id.startsWith("theme") && !c.id.startsWith("tl-") && (c.id.startsWith(word) || c.label.toLowerCase().includes(word))).slice(0, 8) : []),
    [focus, text, word],
  );

  const submit = (value: string) => {
    const out = runCommandLine(value);
    if (out.askAssistant) askAssistant(out.askAssistant, true);
    else setState({ status: out.message });
    if (out.ok) {
      history.current.unshift(value);
      hpos.current = -1;
      setText("");
    }
  };

  return (
    <div className="cmdbar">
      <input
        ref={input}
        value={text}
        aria-label="Command line"
        placeholder='Type a command, e.g. Extrude {"distance": 20} — or press S to search'
        onChange={(e) => (setText(e.target.value), setIdx(0))}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (matches.length && matches[idx] && text.trim().toLowerCase() !== matches[idx].id) {
              const c = matches[idx];
              if (c.hint && c.hint.includes("{")) return setText(c.hint);
              c.run();
              setText("");
              return;
            }
            submit(text);
          } else if (e.key === "Escape") {
            setText("");
            input.current?.blur();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            if (matches.length) setIdx((i) => Math.min(matches.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (matches.length) setIdx((i) => Math.max(0, i - 1));
            else if (history.current.length) {
              hpos.current = Math.min(history.current.length - 1, hpos.current + 1);
              setText(history.current[hpos.current]);
            }
          }
        }}
      />
      {matches.length ? (
        <div className="cmd-suggest" role="listbox">
          {matches.map((c, i) => (
            <button key={c.id} className={i === idx ? "on" : ""} onMouseDown={(e) => (e.preventDefault(), c.hint?.includes("{") ? setText(c.hint) : (c.run(), setText("")))}>
              <code>{c.hint ?? c.id}</code>
              <span>{c.planned ? "planned" : c.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="cmd-status" role="status">{status}</div>
      <div className="cmd-right"><span>{user}</span><span>storage: {storage ?? "…"}</span></div>
    </div>
  );
}

export function Timeline() {
  const plan = useStore((s) => s.plan);
  const regen = useStore((s) => s.regen);
  const rollback = useStore((s) => s.rollback);
  const selection = useStore((s) => s.selection);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const items = timelineOf(plan);
  const end = rollback ?? items.length;
  const roll = (n: number) => {
    const v = Math.max(0, Math.min(items.length, n));
    setState({ rollback: v >= items.length ? null : v, status: v >= items.length ? "Timeline at end" : `Rolled back to step ${v} of ${items.length}` });
    scheduleRegen(0);
  };
  const track = useRef<HTMLDivElement>(null);
  const drag = (e: React.PointerEvent) => {
    const el = track.current!;
    const chips = [...el.querySelectorAll<HTMLElement>(".tl-chip")];
    const move = (ev: PointerEvent) => {
      let n = chips.findIndex((c) => ev.clientX < c.getBoundingClientRect().left + c.offsetWidth / 2);
      if (n < 0) n = chips.length;
      if (n !== (getRoll() ?? items.length)) roll(n);
    };
    const up = () => (window.removeEventListener("pointermove", move), window.removeEventListener("pointerup", up));
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    e.preventDefault();
  };
  return (
    <div className="timeline" role="toolbar" aria-label="Timeline">
      <div className="tl-controls">
        <button className="tb-btn" title="Beginning" onClick={() => roll(0)}><SkipBack size={13} /></button>
        <button className="tb-btn" title="Step back" onClick={() => roll(end - 1)}><StepBack size={13} /></button>
        <button className="tb-btn" title="Step forward" onClick={() => roll(end + 1)}><StepForward size={13} /></button>
        <button className="tb-btn" title="End" onClick={() => roll(items.length)}><SkipForward size={13} /></button>
      </div>
      <div className="tl-sep" />
      <div className="tl-track" ref={track}>
        {items.map(({ body, feature }, i) => {
          const st = regen?.features[feature.id]?.state ?? "ok";
          const Icon = featureIcon(feature);
          const msg = regen?.features[feature.id]?.message;
          return (
            <div key={feature.id} style={{ display: "contents" }}>
              {i === end ? <div className="tl-marker" title="Drag to roll back" onPointerDown={drag} /> : null}
              {i > 0 && items[i - 1].body.id !== body.id ? <div className="tl-gap" /> : null}
              <button
                className={`tl-chip ${st} ${selection?.kind === "feature" && selection.id === feature.id ? "sel" : ""}`}
                style={{ ["--body-color" as string]: body.color }}
                title={`${feature.name ?? feature.id} (${feature.op}) — ${body.name}${msg ? `\n⚠ ${msg}` : ""}${regen?.features[feature.id]?.note ? `\n${regen.features[feature.id].note}` : ""}`}
                aria-label={`${feature.name ?? feature.op} (${feature.op}, ${body.name})${st !== "ok" ? `: ${st}${msg ? ` — ${msg}` : ""}` : ""}`}
                aria-pressed={selection?.kind === "feature" && selection.id === feature.id}
                onClick={() => {
                  // Tap once to select, tap again to edit (double-click is unreliable on touch screens).
                  const sel = getState().selection;
                  if (sel?.kind === "feature" && sel.id === feature.id) setState({ editing: feature.id, editSnapshot: null });
                  else setState({ selection: { kind: "feature", id: feature.id }, status: `${feature.name ?? feature.id} selected — tap again to edit` });
                }}
                onDoubleClick={() => setState({ editing: feature.id, editSnapshot: null, selection: { kind: "feature", id: feature.id } })}
                onContextMenu={(e) => (e.preventDefault(), setState({ selection: { kind: "feature", id: feature.id } }), setMenu({ x: e.clientX, y: e.clientY - 150, id: feature.id }))}
              >
                <Icon size={15} strokeWidth={1.8} aria-hidden />
                {st === "error" ? <span className="tl-badge" aria-hidden>!</span> : null}
              </button>
            </div>
          );
        })}
        {end >= items.length ? <div className="tl-marker" title="Drag to roll back" onPointerDown={drag} /> : null}
      </div>
      <button className="tb-btn tl-settings" title="Timeline settings" onClick={() => setState({ status: `${items.length} features in ${plan.bodies.length} bodies` })}><Settings size={14} /></button>
      {menu ? <TimelineMenu at={menu} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

const getRoll = () => getState().rollback;

function TimelineMenu({ at, onClose }: { at: { x: number; y: number; id: string }; onClose: () => void }) {
  const id = at.id;
  const ids = ["tl-edit", "tl-suppress", "tl-rollto", "tl-delete"];
  const index = timelineOf(getState().plan).findIndex((t) => t.feature.id === id);
  const local = [
    { id: "tl-edit", label: "Edit feature", run: () => setState({ editing: id, editSnapshot: null }) },
    { id: "tl-suppress", label: "Suppress / unsuppress", run: () => commit((p) => { for (const b of p.bodies) for (const f of b.features) if (f.id === id) f.suppressed = !f.suppressed; }, "Suppression toggled") },
    { id: "tl-rollto", label: "Roll history marker here", run: () => (setState({ rollback: index + 1 }), scheduleRegen(0)) },
    { id: "tl-delete", label: "Delete", run: () => deleteFeature(id) },
  ];
  for (const c of local) {
    const existing = COMMANDS.findIndex((x) => x.id === c.id);
    if (existing >= 0) COMMANDS.splice(existing, 1);
    COMMANDS.push(c);
  }
  return <Menu at={at} items={ids.map((x) => ({ id: x }))} onClose={onClose} />;
}
