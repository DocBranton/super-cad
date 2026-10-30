import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary, installGlobalErrorReporting } from "./ui/ErrorBoundary";
import "./styles.css";

installGlobalErrorReporting();
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
