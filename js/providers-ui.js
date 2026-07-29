import { qs, qsa, toast } from "./utils.js";
import {
  getProviderSettings,
  saveProviderSettings,
  clearProviderSettings,
  getActiveProvider,
  setActiveProvider,
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
  const settings = getProviderSettings(providerId);
  const meta = getProviderMeta(providerId);
  card.querySelector(".provider-apikey").value = settings?.apiKey || "";
  card.querySelector(".provider-model").value = settings?.model || "";
  card.querySelector(".provider-model").placeholder = meta?.modelHint || "";
}

export function initProviders() {
  qsa(".provider-card").forEach((card) => {
    const providerId = card.dataset.provider;
    fillCard(card);

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

    card.querySelector('input[type="radio"]').addEventListener("change", () => {
      setActiveProvider(providerId);
      refreshCardStates();
    });
  });

  refreshCardStates();
}
