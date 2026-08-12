import { qs, qsa, toast } from "./utils.js";
import {
  getProviderSettings,
  saveProviderSettings,
  clearProviderSettings,
  getActiveProvider,
  setActiveProvider,
  getCustomProviderLink,
  saveCustomProviderLink,
  clearCustomProviderLink,
} from "./state.js";
import { getProviderMeta } from "./providers.js";

function refreshCardStates() {
  const active = getActiveProvider();
  qsa(".provider-card").forEach((card) => {
    const providerId = card.dataset.provider;
    card.classList.toggle("is-active", providerId === active);
    const radio = card.querySelector('input[type="radio"]');
    if (radio) radio.checked = providerId === active;
  });
}

function fillCard(card) {
  const providerId = card.dataset.provider;
  if (providerId === "custom") {
    const custom = getCustomProviderLink();
    card.querySelector(".provider-custom-name").value = custom?.name || "";
    card.querySelector(".provider-custom-url").value = custom?.url || "";
    return;
  }
  const settings = getProviderSettings(providerId);
  const meta = getProviderMeta(providerId);
  card.querySelector(".provider-apikey").value = settings?.apiKey || "";
  card.querySelector(".provider-model").value = settings?.model || "";
  card.querySelector(".provider-model").placeholder = meta?.modelHint || "";
}

// "custom" has no API key at all — it's just a name+URL the user typed in,
// so its save/clear wiring differs from the API-key providers' below.
function wireCustomCard(card) {
  card.querySelector(".provider-save").addEventListener("click", () => {
    const name = card.querySelector(".provider-custom-name").value.trim();
    const url = card.querySelector(".provider-custom-url").value.trim();
    if (!url) {
      toast("Inserisci il link prima di salvare.", "error");
      return;
    }
    saveCustomProviderLink({ name, url });
    toast("Link IA personalizzata salvato.", "success");
  });

  card.querySelector(".provider-clear").addEventListener("click", () => {
    clearCustomProviderLink();
    fillCard(card);
    toast("Link IA personalizzata cancellato.", "info");
  });
}

function wireApiKeyCard(card, providerId) {
  card.querySelector(".provider-save").addEventListener("click", () => {
    const apiKey = card.querySelector(".provider-apikey").value.trim();
    const model = card.querySelector(".provider-model").value.trim();
    if (!apiKey) {
      toast("Inserisci una API key prima di salvare.", "error");
      return;
    }
    saveProviderSettings(providerId, { apiKey, model });
    toast(`Impostazioni ${getProviderMeta(providerId)?.label || providerId} salvate.`, "success");
  });

  card.querySelector(".provider-clear").addEventListener("click", () => {
    clearProviderSettings(providerId);
    fillCard(card);
    toast(`Chiave ${getProviderMeta(providerId)?.label || providerId} cancellata.`, "info");
  });
}

export function initProviders() {
  qsa(".provider-card").forEach((card) => {
    const providerId = card.dataset.provider;
    fillCard(card);

    if (providerId === "custom") wireCustomCard(card);
    else wireApiKeyCard(card, providerId);

    card.querySelector('input[type="radio"]').addEventListener("change", () => {
      setActiveProvider(providerId);
      refreshCardStates();
    });
  });

  refreshCardStates();
}
