const SETTINGS_KEY = "comic-studio:connection";
const ACTIVE_WORKFLOW_KEY = "comic-studio:active-workflow";
const GENERATION_MODE_KEY = "comic-studio:generation-mode";
const ACTIVE_PROVIDER_KEY = "comic-studio:active-provider";
const PROVIDERS_KEY = "comic-studio:providers";

const listeners = new Set();

function notify(event, payload) {
  for (const fn of listeners) fn(event, payload);
}

export function onStateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getConnectionSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveConnectionSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  notify("connection-updated", settings);
}

export function clearConnectionSettings() {
  localStorage.removeItem(SETTINGS_KEY);
  notify("connection-updated", null);
}

export function getActiveWorkflowId() {
  return localStorage.getItem(ACTIVE_WORKFLOW_KEY) || null;
}

export function setActiveWorkflowId(id) {
  if (id) localStorage.setItem(ACTIVE_WORKFLOW_KEY, id);
  else localStorage.removeItem(ACTIVE_WORKFLOW_KEY);
  notify("active-workflow-updated", id);
}

export function baseUrlFromSettings(settings) {
  if (!settings?.ip || !settings?.port) return null;
  return `${settings.protocol || "http"}://${settings.ip}:${settings.port}`;
}

// --- Generation mode: "local" (ComfyUI) vs "external" (Gemini/OpenAI/Leonardo) ---

export function getGenerationMode() {
  return localStorage.getItem(GENERATION_MODE_KEY) || "local";
}

export function setGenerationMode(mode) {
  localStorage.setItem(GENERATION_MODE_KEY, mode);
  notify("generation-mode-updated", mode);
}

export function getActiveProvider() {
  return localStorage.getItem(ACTIVE_PROVIDER_KEY) || "gemini";
}

export function setActiveProvider(provider) {
  localStorage.setItem(ACTIVE_PROVIDER_KEY, provider);
  notify("active-provider-updated", provider);
}

function getAllProviderSettings() {
  try {
    const raw = localStorage.getItem(PROVIDERS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getProviderSettings(provider) {
  return getAllProviderSettings()[provider] || null;
}

export function saveProviderSettings(provider, settings) {
  const all = getAllProviderSettings();
  all[provider] = settings;
  localStorage.setItem(PROVIDERS_KEY, JSON.stringify(all));
  notify("provider-settings-updated", { provider, settings });
}

export function clearProviderSettings(provider) {
  const all = getAllProviderSettings();
  delete all[provider];
  localStorage.setItem(PROVIDERS_KEY, JSON.stringify(all));
  notify("provider-settings-updated", { provider, settings: null });
}
