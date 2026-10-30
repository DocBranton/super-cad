// Last line of defence: if anything throws while drawing the page, show what happened and a
// way back, instead of a blank screen. Errors are also reported to the server log.
import { Component, type ReactNode } from "react";
import { getState, setState, undo } from "../state/store";

let reported = 0;

/** Send a client-side error to the app log (POST /api/client-error). At most 20 per page load. */
export function reportClientError(kind: string, error: unknown, extra: Record<string, unknown> = {}) {
  if (reported++ >= 20) return;
  const e = error as { message?: string; stack?: string } | undefined;
  const body = {
    kind,
    message: String(e?.message ?? error).slice(0, 500),
    stack: String(e?.stack ?? "").slice(0, 2000),
    plan: getState().plan.name,
    editing: getState().editing,
    viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio}`,
    ...extra,
  };
  try {
    navigator.sendBeacon?.("/api/client-error", new Blob([JSON.stringify(body)], { type: "application/json" })) ||
      fetch("/api/client-error", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true });
  } catch {
    // reporting must never throw
  }
}

export function installGlobalErrorReporting() {
  window.addEventListener("error", (e) => reportClientError("window.error", e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => reportClientError("unhandledrejection", e.reason));
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    reportClientError("render", error, { componentStack: String(info.componentStack ?? "").slice(0, 1500) });
  }

  private recover = (undoLast: boolean) => {
    if (undoLast) undo();
    setState({ editing: null, editSnapshot: null, dialog: null, showHome: false });
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <div className="crash-box">
          <h1>Something went wrong drawing the workbench</h1>
          <p>Your design is still in memory. Try returning to it, or undo the last change if the problem came from it. The error has been sent to the app log.</p>
          <pre>{this.state.error.message}</pre>
          <div className="crash-actions">
            <button className="btn primary" onClick={() => this.recover(false)}>Return to the design</button>
            <button className="btn" onClick={() => this.recover(true)}>Undo last change</button>
            <button className="btn" onClick={() => location.reload()}>Reload</button>
          </div>
        </div>
      </div>
    );
  }
}
