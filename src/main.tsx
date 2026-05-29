import React from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router";
import { HAS_TAURI_RUNTIME, IS_MACOS } from "@/lib/platform";
// Register all providers eagerly so they're available before any component renders
import "@/providers/claude-code";
import "@/providers/codex";
import App from "./App";
import "./index.css";

document.documentElement.dataset.platform = IS_MACOS ? "macos" : "default";

function hasSelectedText() {
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString().trim().length > 0;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;

  return Boolean(
    target.closest(
      [
        "input",
        "textarea",
        "select",
        "[contenteditable='']",
        "[contenteditable='true']",
        "[role='textbox']",
        "[data-allow-native-context-menu]",
      ].join(", "),
    ),
  );
}

if (HAS_TAURI_RUNTIME) {
  window.addEventListener("contextmenu", (event) => {
    if (event.defaultPrevented) {
      return;
    }

    if (isEditableTarget(event.target) || hasSelectedText()) {
      return;
    }

    // Prevent the webview from falling back to browser-like page menus
    // such as Reload / Inspect Element on generic app surfaces.
    event.preventDefault();
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MemoryRouter>
      <App />
    </MemoryRouter>
  </React.StrictMode>,
);
