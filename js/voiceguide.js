import { qs, el, toast } from "./utils.js";
import { getVoiceGuideEnabled, setVoiceGuideEnabled, getVoiceGuideVoiceName, setVoiceGuideVoiceName } from "./state.js";

// Reads aloud, in Italian, what the current tab/page lets you do — an
// opt-in accessibility/onboarding aid using the browser's built-in
// text-to-speech (SpeechSynthesis), so it needs no API key and works
// offline. Separate from voice.js, which is speech-TO-text (dictation into
// text fields) — this is the other direction, text-to-speech guidance.
const SpeechSynthesisImpl = window.speechSynthesis;

// One short, spoken-friendly paragraph per tab describing what's possible
// there — kept in sync by hand with each tab's actual features rather than
// generated from the DOM, so the wording reads naturally out loud instead
// of listing raw button labels.
const PAGE_GUIDES = {
  "tab-guide":
    "Sei nella Guida rapida, la pagina iniziale dell'app. Qui trovi una panoramica di tutte le funzioni di Comic Studio e un tasto per attivare questa stessa guida vocale nella scheda Opzioni.",
  "tab-connection":
    "Sei nella scheda Connessione ComfyUI. Qui colleghi l'app al tuo ComfyUI in rete locale: inserisci indirizzo IP e porta, se serve anche utente e password, poi premi Connetti per verificare che funzioni.",
  "tab-providers":
    "Sei nella scheda IA Esterne. Qui inserisci le chiavi API di intelligenze artificiali come Google Gemini, OpenAI o Leonardo punto AI, per generare immagini senza bisogno di ComfyUI.",
  "tab-workflows":
    "Sei nella scheda Workflow. Qui carichi i tuoi flussi ComfyUI in formato JSON, colleghi i nodi giusti per prompt, seme, risoluzione e immagini, e puoi controllare quali modelli sono compatibili con ogni flusso caricato.",
  "tab-characters":
    "Sei nella scheda Personaggi. Qui gestisci l'archivio dei tuoi personaggi: carica foto dalla galleria o scatta una foto al momento, rinominali, e tocca l'icona a forma di occhio per nascondere un'immagine privata.",
  "tab-charsheet":
    "Sei nella scheda Scheda Personaggio. Qui scegli un personaggio già salvato e generi in automatico sei immagini da angolazioni diverse, in stile scheda modello da studio, scegliendo se solo il viso o la figura intera.",
  "tab-prompt":
    "Sei nella scheda Crea Scena. Qui costruisci una scena passo per passo: scegli il personaggio, scrivi la descrizione della scena, imposta la camera con la regia, poi traduci il prompt e genera l'immagine con ComfyUI o con un'intelligenza artificiale esterna.",
  "tab-archive":
    "Sei nella scheda Archivio. Qui trovi tutte le immagini generate finora. Puoi nasconderle per privacy, attivarle per il progetto corrente, scaricarle o copiarle.",
  "tab-backup":
    "Sei nella scheda Backup. Qui colleghi il tuo Google Drive personale per salvare automaticamente personaggi, flussi e immagini, e ritrovarli anche su un altro dispositivo.",
  "tab-options":
    "Sei nella scheda Opzioni. Qui puoi attivare o disattivare questa guida vocale e scegliere quale voce usare.",
};

let currentTabId = null;

function isSupported() {
  return !!SpeechSynthesisImpl;
}

function pickVoice() {
  const voices = SpeechSynthesisImpl.getVoices();
  const savedName = getVoiceGuideVoiceName();
  if (savedName) {
    const saved = voices.find((v) => v.name === savedName);
    if (saved) return saved;
  }
  // No explicit choice saved (or it's no longer available on this
  // device/browser): prefer any Italian voice over the system default,
  // since the guide text is always Italian.
  return voices.find((v) => v.lang?.toLowerCase().startsWith("it")) || null;
}

function speak(text) {
  if (!isSupported() || !text) return;
  SpeechSynthesisImpl.cancel(); // never let two pages' guides overlap
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "it-IT";
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  SpeechSynthesisImpl.speak(utterance);
}

// Called from app.js's switchTab() — the single funnel every tab change
// (button clicks and the "request-tab" event alike) already goes through —
// so the guide reacts to every kind of navigation without its own listener.
export function announceTab(tabId) {
  currentTabId = tabId;
  if (!getVoiceGuideEnabled()) return;
  speak(PAGE_GUIDES[tabId]);
}

function handleRepeat() {
  if (!isSupported()) {
    toast("Il tuo browser non supporta la sintesi vocale.", "error");
    return;
  }
  if (!currentTabId) return;
  speak(PAGE_GUIDES[currentTabId] || "Nessuna guida disponibile per questa pagina.");
}

function populateVoiceSelect() {
  const select = qs("#voice-guide-voice-select");
  if (!select) return;
  const voices = SpeechSynthesisImpl.getVoices();
  const savedName = getVoiceGuideVoiceName();
  select.innerHTML = "";
  select.appendChild(el("option", { value: "" }, "Predefinita (italiana se disponibile)"));
  for (const v of voices) {
    select.appendChild(el("option", { value: v.name, selected: v.name === savedName ? "selected" : false }, `${v.name} (${v.lang})`));
  }
}

export function initVoiceGuide() {
  const toggle = qs("#voice-guide-toggle");
  const repeatBtn = qs("#voice-guide-repeat-btn");
  const voiceSelect = qs("#voice-guide-voice-select");
  const unsupportedHint = qs("#voice-guide-unsupported");

  // switchTab() only calls announceTab() on an actual tab change, so without
  // this the very first tab shown at load (before any click) would have no
  // known "current" page for the toggle-on / repeat actions to read.
  currentTabId = qs(".tab-panel.active")?.id || currentTabId;

  if (!isSupported()) {
    if (toggle) toggle.disabled = true;
    if (repeatBtn) repeatBtn.disabled = true;
    if (voiceSelect) voiceSelect.disabled = true;
    if (unsupportedHint) unsupportedHint.hidden = false;
    return;
  }

  if (toggle) {
    toggle.checked = getVoiceGuideEnabled();
    toggle.addEventListener("change", () => {
      setVoiceGuideEnabled(toggle.checked);
      if (toggle.checked) {
        // Immediate feedback that it's on, read for whichever tab is open
        // right now rather than waiting for the next navigation.
        announceTab(currentTabId);
      } else {
        SpeechSynthesisImpl.cancel();
      }
    });
  }

  if (repeatBtn) repeatBtn.addEventListener("click", handleRepeat);

  // Voice list loads asynchronously on most browsers (fires later even
  // though getVoices() also returns an empty array synchronously at
  // first) — populate now in case it's already ready, and again once the
  // real list arrives.
  populateVoiceSelect();
  SpeechSynthesisImpl.addEventListener("voiceschanged", populateVoiceSelect);

  if (voiceSelect) {
    voiceSelect.addEventListener("change", () => {
      setVoiceGuideVoiceName(voiceSelect.value);
    });
  }

  // If the guide was already on from a previous visit, announce the
  // starting tab right away — note most browsers require at least one user
  // interaction with the page before they'll actually play synthesized
  // speech, so this call may be silently deferred until the user's first
  // tap/click; that's a browser autoplay-policy limit, not a bug here.
  if (getVoiceGuideEnabled()) announceTab(currentTabId);
}
