import { useEffect } from "react";
import { PanelLeft, Sparkles } from "lucide-react";
import { TitleBar, Ribbon } from "./ui/Chrome";
import { Browser } from "./ui/Browser";
import { Viewport } from "./ui/Viewport";
import { CommandBar, Timeline } from "./ui/Bottom";
import { Assistant } from "./ui/Assistant";
import { Home } from "./ui/Home";
import { AboutDialog, FeatureDialog, ParametersDialog, ProjectsDialog, PropertiesDialog, ValidationDialog } from "./ui/Dialogs";
import { command } from "./commands";
import { getState, loadConfig, setState, startKernel, useStore } from "./state/store";

export function App() {
  const dialog = useStore((s) => s.dialog);
  const assistantOpen = useStore((s) => s.assistantOpen);
  const browserOpen = useStore((s) => s.browserOpen);
  const showHome = useStore((s) => s.showHome);
  const banner = useStore((s) => s.config?.classification);

  useEffect(() => {
    loadConfig();
    startKernel();
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, select");
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") return e.preventDefault(), command("save").run();
      if (mod && e.key.toLowerCase() === "o") return e.preventDefault(), command("open").run();
      if (typing) return;
      if (mod && e.key.toLowerCase() === "z") return e.preventDefault(), command(e.shiftKey ? "redo" : "undo").run();
      if (mod && e.key.toLowerCase() === "y") return e.preventDefault(), command("redo").run();
      if (mod) return;
      const keys: Record<string, string> = { e: "extrude", h: "hole", f: "fillet", p: "parameters", v: "validate", i: "si", F6: "fit", Delete: "delete" };
      if (e.key === "Escape") return getState().editing ? undefined : setState({ selection: null, dialog: null });
      const id = keys[e.key] ?? keys[e.key.toLowerCase()];
      if (id) (e.preventDefault(), command(id).run());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      {banner ? <div className="banner">{banner}</div> : <div />}
      <TitleBar />
      <Ribbon />
      <main className={`workspace ${assistantOpen ? "with-assistant" : ""}`} aria-label="Design workspace">
        {browserOpen ? <Browser /> : <button className="tb-btn" style={{ position: "absolute", left: 6, top: 6, zIndex: 5 }} title="Show browser" onClick={() => setState({ browserOpen: true })}><PanelLeft size={15} /></button>}
        <Viewport />
        {assistantOpen ? <Assistant /> : <button className="tb-btn" style={{ position: "absolute", right: 118, top: 10, zIndex: 5, color: "var(--icon-alt)" }} title="SI assistant (I)" onClick={() => setState({ assistantOpen: true })}><Sparkles size={16} /></button>}
        <FeatureDialog />
        {dialog === "parameters" && <ParametersDialog />}
        {dialog === "validation" && <ValidationDialog />}
        {dialog === "properties" && <PropertiesDialog />}
        {dialog === "projects" && <ProjectsDialog />}
        {dialog === "about" && <AboutDialog />}
        {showHome && <Home />}
      </main>
      <CommandBar />
      <Timeline />
      {banner ? <div className="banner">{banner}</div> : <div />}
    </div>
  );
}
