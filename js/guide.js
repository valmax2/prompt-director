import { qsa } from "./utils.js";

// Wires every "Vai →" button on the landing Guida page (and anywhere else
// that adopts the same convention) to jump to the tab it names, via the
// same "request-tab" event other modules already use for cross-module
// navigation — so this stays a plain data attribute, no per-button JS.
export function initGuide() {
  qsa("[data-goto-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("request-tab", { detail: btn.dataset.gotoTab }));
    });
  });
}
