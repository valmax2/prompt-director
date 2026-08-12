const SETTINGS_KEY = "comic-studio:connection";
const ACTIVE_WORKFLOW_KEY = "comic-studio:active-workflow";
const GENERATION_MODE_KEY = "comic-studio:generation-mode";
const ACTIVE_PROVIDER_KEY = "comic-studio:active-provider";
const PROVIDERS_KEY = "comic-studio:providers";
const VOICE_GUIDE_ENABLED_KEY = "comic-studio:voice-guide-enabled";
const VOICE_GUIDE_VOICE_KEY = "comic-studio:voice-guide-voice";
const CUSTOM_PROVIDER_LINK_KEY = "comic-studio:custom-provider-link";

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

// --- Voice guide: reads aloud what each page/tab lets you do, opt-in ---

export function getVoiceGuideEnabled() {
  return localStorage.getItem(VOICE_GUIDE_ENABLED_KEY) === "true";
}

export function setVoiceGuideEnabled(enabled) {
  localStorage.setItem(VOICE_GUIDE_ENABLED_KEY, enabled ? "true" : "false");
  notify("voice-guide-enabled-updated", enabled);
}

// Stores the chosen voice by its (browser-assigned) name, since
// SpeechSynthesisVoice objects themselves aren't serializable/stable across
// reloads — empty string means "browser default".
export function getVoiceGuideVoiceName() {
  return localStorage.getItem(VOICE_GUIDE_VOICE_KEY) || "";
}

export function setVoiceGuideVoiceName(name) {
  if (name) localStorage.setItem(VOICE_GUIDE_VOICE_KEY, name);
  else localStorage.removeItem(VOICE_GUIDE_VOICE_KEY);
  notify("voice-guide-voice-updated", name);
}

// --- Custom external-AI link: any site the user wants (Leonardo.ai,
// Midjourney, Bing Image Creator, ...) instead of a fixed, hardcoded
// provider. No API integration — this only feeds the "IA personalizzata"
// entry in the provider picker for the copy-and-paste generation path. ---

export function getCustomProviderLink() {
  try {
    const raw = localStorage.getItem(CUSTOM_PROVIDER_LINK_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCustomProviderLink({ name, url }) {
  localStorage.setItem(CUSTOM_PROVIDER_LINK_KEY, JSON.stringify({ name, url }));
  notify("custom-provider-link-updated", { name, url });
}

export function clearCustomProviderLink() {
  localStorage.removeItem(CUSTOM_PROVIDER_LINK_KEY);
  notify("custom-provider-link-updated", null);
}
