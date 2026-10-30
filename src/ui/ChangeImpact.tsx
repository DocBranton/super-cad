import { useMemo, useState } from "react";
import { Activity, ChevronDown, ChevronRight } from "lucide-react";
import { useStore } from "../state/store";
import { changeImpact } from "../../shared/change-impact.js";

// Compare the active model with the immediately preceding undo snapshot.
export function ChangeImpact() {
  const plan = useStore(s => s.plan);
  const past = useStore(s => s.past);
  const [open, setOpen] = useState(false);
  const result = useMemo(() => past.length ? changeImpact(past[past.length - 1], plan) : null, [past, plan]);
  return (
    <section aria-label="Design change impact" style={{ borderBottom: "1px solid var(--border, #314357)", padding: "7px 10px", fontSize: 12 }}>
      <button className="tb-btn" style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", justifyContent: "flex-start" }} onClick={() => setOpen(!open)} aria-expanded={open}>
        <Activity size={14} /> CHANGE IMPACT {result ? <span style={{ marginLeft: "auto" }}>{result.affected.length} affected</span> : <span style={{ marginLeft: "auto" }}>No prior edit</span>}
        {open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}
      </button>
      {open && <div style={{ padding: "7px 4px", maxHeight: 165, overflowY: "auto" }}>
        {!result ? "Make a parameter or feature edit to see its impact." : <>
          <div><b>Parameters:</b> {result.changedParameters.join(", ") || "none"}</div>
          {result.derivedParameters.length > 0 && <div><b>Dependent parameters:</b> {result.derivedParameters.join(", ")}</div>}
          <div><b>Potentially affected features:</b> {result.affected.length}</div>
          {result.affected.slice(0, 14).map(f => <div key={f.bodyId + f.featureId} style={{ opacity: f.direct ? 1 : .72, paddingLeft: 7 }}>• {f.body} / {f.feature} {f.direct ? "(direct)" : "(downstream)"}</div>)}
          {result.removedBodies.length > 0 && <div>Removed: {result.removedBodies.join(", ")}</div>}
          <div style={{ marginTop: 5, opacity: .8 }}>Advisory only — run geometry validation after changes.</div>
        </>}
      </div>}
    </section>
  );
}
