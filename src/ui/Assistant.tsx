// SI design assistant dock: narrative in, reviewed feature plan out. Nothing builds until approved.
import { useEffect, useRef, useState } from "react";
import { Sparkles, X, LoaderCircle, Check, Ban } from "lucide-react";
import { approvePlan, askAssistant, discardPlan, setState, useStore } from "../state/store";

const SUGGESTIONS = [
  "Design a rugged equipment mount for a communications module: aluminum, 120 mm long, 50 mm wide, M5 mounting holes.",
  "Radio module enclosure 140 mm long, 80 mm wide, 40 mm tall, 3 mm wall, PETG, two 14 mm connector ports.",
  "Make the mounting holes 8 mm and the base plate 12 mm thick.",
];

export function Assistant() {
  const chat = useStore((s) => s.chat);
  const si = useStore((s) => s.config?.si);
  const [text, setText] = useState("");
  const [modify, setModify] = useState(true);
  const list = useRef<HTMLDivElement>(null);
  // Braces matter: an effect must return nothing or a cleanup function. Newer Chrome returns a
  // Promise from scrollTo(), which React would later call as a cleanup and crash.
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [chat]);
  const busy = chat.some((c) => c.status === "pending");
  const send = (t = text) => {
    if (!t.trim() || busy) return;
    askAssistant(t.trim(), modify);
    setText("");
  };
  return (
    <aside className="assistant" aria-label="SI design assistant">
      <div className="panel-head"><span style={{ display: "flex", alignItems: "center", gap: 6 }}><Sparkles size={12} color="var(--icon-alt)" /> SI DESIGN ASSISTANT</span>
        <button className="tb-btn" style={{ width: 20, height: 18 }} title="Close" onClick={() => setState({ assistantOpen: false })}><X size={12} /></button></div>
      <div className={`msg ${si?.configured ? "info" : "warn"} planner-badge`}>
        {si?.configured ? <>Planner: Model Serving <code>{si.endpoint}</code>. Requests stay inside the Databricks workspace.</> : <>Offline template planner — it adjusts template dimensions only.{si?.reason ? <><br /><small>{si.reason}</small></> : null}</>}
      </div>
      <div className="chat" ref={list}>
        {chat.length === 0 ? (
          <div className="empty-chat">
            <div><b style={{ color: "var(--text-strong)" }}>Describe what you want to design.</b><br />The assistant proposes an editable parametric feature plan. You review its assumptions and approve before anything is built. Plans are data, never code.</div>
            {SUGGESTIONS.map((s) => <button key={s} className="suggestion" onClick={() => send(s)}>{s}</button>)}
          </div>
        ) : chat.map((c) => (
          <div key={c.id} className={`bubble ${c.role}`}>
            {c.status === "pending" ? <><LoaderCircle size={12} className="spin" /> {c.text}</> : c.text}
            {c.plan && c.plan.assumptions.length ? (
              <ul>
                {c.plan.assumptions.map((a, i) => {
                  const m = /^(NOT SUPPORTED|CHECK):\s*/.exec(a);
                  return m ? (
                    <li key={i} className={m[1] === "CHECK" ? "flag-check" : "flag-unsupported"}><strong>{m[1] === "CHECK" ? "Check" : "Not supported"}:</strong> {a.slice(m[0].length)}</li>
                  ) : <li key={i}>{a}</li>;
                })}
              </ul>
            ) : null}
            {c.plan && c.status === "proposed" ? (
              <div className="actions">
                <button className="btn primary" onClick={() => approvePlan(c)}><Check size={13} /> Approve &amp; build</button>
                <button className="btn" onClick={() => discardPlan(c)}><Ban size={13} /> Discard</button>
              </div>
            ) : null}
            {c.status === "applied" ? <div className="tag">Built — unverified until checks run (V)</div> : null}
            {c.status === "discarded" ? <div className="tag">Discarded</div> : null}
            {c.planner ? <div className="tag">{c.planner}</div> : null}
          </div>
        ))}
      </div>
      <div className="composer">
        <label htmlFor="si-prompt" className="section-label">DESIGN NARRATIVE</label>
        <textarea id="si-prompt" value={text} placeholder="e.g. a two-piece mounting bracket for field equipment, aluminium, 3 mm thick, 50 mm hole spacing…" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); }} />
        <div className="row">
          <label className="check" title="Send the current plan so the assistant edits it instead of starting over"><input type="checkbox" checked={modify} onChange={(e) => setModify(e.target.checked)} /> Modify current design</label>
          <button className="btn primary" disabled={busy || !text.trim()} onClick={() => send()}>Generate <span aria-hidden>→</span></button>
        </div>
      </div>
    </aside>
  );
}
