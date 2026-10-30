// Home tab: start a design from a template or a description, or reopen a saved project.
import { useEffect, useState } from "react";
import { Boxes, Box, Sparkles, FolderOpen } from "lucide-react";
import { askAssistant, listProjects, openProject, setState, useStore } from "../state/store";
import { newFrom } from "../commands";

export function Home() {
  const [prompt, setPrompt] = useState("");
  const [recent, setRecent] = useState<Awaited<ReturnType<typeof listProjects>>>([]);
  const user = useStore((s) => s.config?.user);
  useEffect(() => {
    listProjects().then(setRecent, () => setRecent([]));
  }, []);
  const go = () => {
    if (!prompt.trim()) return;
    askAssistant(prompt.trim(), false);
    setState({ showHome: false });
  };
  return (
    <div className="home">
      <div className="home-inner">
        <div>
          <h1>CAD <em>WORKBENCH</em></h1>
          <div className="tagline">DESIGN SOLUTIONS. ACCELERATE READINESS.</div>
        </div>
        <div>
          <h2>DESCRIBE A PART</h2>
          <div className="home-prompt">
            <input aria-label="Describe a part" value={prompt} placeholder="Design a rugged equipment mount for a communications module. Aluminium, 3 mm thick…" onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
            <button className="btn primary" style={{ height: 34 }} onClick={go}><Sparkles size={14} /> Generate</button>
          </div>
        </div>
        <div>
          <h2>START FROM A TEMPLATE</h2>
          <div className="cards">
            <button className="card" onClick={() => newFrom("bracket")}><strong><Boxes size={16} /> Two-part mounting bracket</strong><span>Base with countersunk holes and an upper tube clamp. The contract's acceptance scenario.</span></button>
            <button className="card" onClick={() => newFrom("enclosure")}><strong><Box size={16} /> Module enclosure</strong><span>Shelled box with filleted corners, connector ports and a vent slot.</span></button>
            <button className="card" onClick={() => newFrom("impeller")}><strong><Box size={16} /> Turbine impeller</strong><span>12 twisted blades on a hub, bolt circle, chamfered bore, perimeter groove. Every count and angle is a parameter.</span></button>
            <button className="card" onClick={() => newFrom("plaque")}><strong><Box size={16} /> Plaque with raised text</strong><span>Rounded plate, recessed border, countersunk holes. Text, font size and depth are parameters.</span></button>
            <button className="card" onClick={() => setState({ dialog: "projects" })}><strong><FolderOpen size={16} /> Open a project</strong><span>Saved revisions in your workspace storage.</span></button>
          </div>
        </div>
        <div>
          <h2>RECENT PROJECTS {user ? `· ${user}` : ""}</h2>
          <div className="recent">
            {recent.length === 0 ? <div className="msg info">Nothing saved yet.</div> : recent.slice(0, 8).map((p) => (
              <button key={p.id} onClick={() => openProject(p.id)}>
                <span>{p.name}</span><span className="muted">{p.revisions} revision{p.revisions === 1 ? "" : "s"}</span>
                <span style={{ color: p.validation === "validated" ? "var(--ok)" : "var(--warn)" }}>{p.validation}</span>
                <span className="muted">{p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : ""}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
