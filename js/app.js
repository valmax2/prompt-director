import { qs, qsa, toast } from "./utils.js";
import { getConnectionSettings, saveConnectionSettings, clearConnectionSettings, getGenerationMode, setGenerationMode } from "./state.js";
import { ComfyUIClient, ComfyUIError } from "./comfyui.js";
import { initWorkflows } from "./workflows.js";
import { initCharacters } from "./characters.js";
import { initPrompts } from "./prompts.js";
import { initDirector } from "./director.js";
import { initArchive } from "./archive.js";
import { initProviders } from "./providers-ui.js";
import { initScenes } from "./scenes.js";
import { APP_VERSION, APP_VERSION_LABEL, APP_VERSION_NOTES } from "./version.js";
import { initPickerModal } from "./picker-modal.js";
import { initModelInventory } from "./models.js";

function switchTab(tabId) {
  qsa(".tab-btn").forEach((btn) => {
    const active = btn.dataset.tab === tabId;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  qsa(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === tabId));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function initTabs() {
  qsa(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  window.addEventListener("request-tab", (e) => switchTab(e.detail));
}

function setConnectionBadge(connected, label) {
  const badge = qs("#connection-badge");
  badge.classList.toggle("connected", connected);
  qs("#connection-label").textContent = label;
}

function setConnStatus(message, type = "") {
  const box = qs("#conn-status");
  box.textContent = message;
  box.className = `status-box${type ? " " + type : ""}`;
}

function fillConnectionForm(settings) {
  if (!settings) return;
  qs("#conn-protocol").value = settings.protocol || "http";
  qs("#conn-ip").value = settings.ip || "";
  qs("#conn-port").value = settings.port || "";
  qs("#conn-user").value = settings.user || "";
  qs("#conn-pass").value = settings.pass || "";
}

async function testAndReport(settings, { silent = false } = {}) {
  try {
    const client = new ComfyUIClient(settings);
    const stats = await client.testConnection();
    const version = stats?.system?.comfyui_version ? ` (v${stats.system.comfyui_version})` : "";
    setConnectionBadge(true, `Connesso${version}`);
    if (!silent) setConnStatus("Connessione riuscita.", "ok");
    return true;
  } catch (err) {
    setConnectionBadge(false, "Non connesso");
    const message = err instanceof ComfyUIError ? err.message : `Errore: ${err.message}`;
    if (!silent) setConnStatus(message, "error");
    return false;
  }
}

function initConnection() {
  const existing = getConnectionSettings();
  fillConnectionForm(existing);
  if (existing) testAndReport(existing, { silent: true });

  qs("#connection-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const settings = {
      protocol: qs("#conn-protocol").value,
      ip: qs("#conn-ip").value.trim(),
      port: qs("#conn-port").value.trim(),
      user: qs("#conn-user").value.trim(),
      pass: qs("#conn-pass").value,
    };
    if (!settings.ip || !settings.port) {
      setConnStatus("Indirizzo IP e porta sono obbligatori.", "error");
      return;
    }
    saveConnectionSettings(settings);
    setConnStatus("Test della connessione in corso...");
    const ok = await testAndReport(settings);
    toast(ok ? "Connesso a ComfyUI." : "Connessione non riuscita: verifica i parametri.", ok ? "success" : "error");
  });

  qs("#conn-clear").addEventListener("click", () => {
    clearConnectionSettings();
    qs("#connection-form").reset();
    setConnectionBadge(false, "Non connesso");
    setConnStatus("Dati di connessione cancellati.");
    toast("Dati di connessione cancellati.", "info");
  });
}

function applyModeUI(mode) {
  qs("#mode-local-btn").classList.toggle("active", mode === "local");
  qs("#mode-external-btn").classList.toggle("active", mode === "external");
  qs("#connection-badge").classList.toggle("dim", mode !== "local");
  window.dispatchEvent(new CustomEvent("generation-mode-ui-updated", { detail: mode }));
}

function initModeSwitch() {
  applyModeUI(getGenerationMode());
  qs("#mode-local-btn").addEventListener("click", () => {
    setGenerationMode("local");
    applyModeUI("local");
  });
  qs("#mode-external-btn").addEventListener("click", () => {
    setGenerationMode("external");
    applyModeUI("external");
  });
}

function initVersionLabel() {
  document.title = `${document.title.split(" · v")[0]} · v${APP_VERSION}`;
  const footerLabel = qs("#app-version-label");
  if (footerLabel) footerLabel.textContent = `${APP_VERSION_LABEL} — ${APP_VERSION_NOTES}`;
  const badge = qs("#app-version-badge");
  if (badge) badge.textContent = `· v${APP_VERSION}`;
}

async function init() {
  initVersionLabel();
  initPickerModal();
  initTabs();
  initModeSwitch();
  initConnection();
  initProviders();
  initModelInventory();
  await initWorkflows();
  await initCharacters();
  initPrompts();
  initDirector();
  initScenes();
  await initArchive();
}

init().catch((err) => {
  console.error(err);
  toast(`Errore di inizializzazione: ${err.message}`, "error", 8000);
});
