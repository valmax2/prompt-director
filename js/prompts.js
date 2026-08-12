import { qs, qsa, el, toast, copyToClipboard, copyImageToClipboard, uid, thumbWithPrivacyToggle } from "./utils.js";
import { translateItToEn, optimizePrompt, tagify, DEFAULT_NEGATIVE_EN } from "./translate.js";
import { optimizeForAiAcceptance, optimizeForCopyrightSafety } from "./promptsafety.js";
import { listCharacters, getCharacterById, setCharacterVisibility } from "./characters.js";
import { getActiveWorkflow } from "./workflows.js";
import { getConnectionSettings, getGenerationMode, getActiveProvider, getProviderSettings, onStateChange } from "./state.js";
import { ComfyUIClient, ComfyUIError } from "./comfyui.js";
import { addArchiveImage, refreshArchive } from "./archive.js";
import { getAppliedDirectorTags, setFullDirectorState } from "./director.js";
import { generateImageExternal, getProviderMeta, ProviderError } from "./providers.js";
import { initVoiceDictation } from "./voice.js";
import { COHERENT_MODE_PRESETS, buildConsistencyBlock } from "./consistency.js";
import { STYLE_GROUPS } from "./catalogs.js";
import { openPickerModal } from "./picker-modal.js";

const sessionClientId = uid();
const DRAFT_KEY = "comic-studio:prompt-draft";
let lastGenerated = { positive: "", negative: "" };

// Style is picked via the big "Modifica stile" modal instead of a <select>,
// so its value lives here instead of on a form element's .value.
let selectedStyleTag = "";

function findStyleByTag(tag) {
  for (const group of STYLE_GROUPS) {
    const found = group.options.find((o) => o.tag === tag);
    if (found) return found;
  }
  return null;
}

function setSelectedStyle(tag) {
  selectedStyleTag = tag || "";
  qs("#prompt-style-current").textContent = selectedStyleTag ? findStyleByTag(selectedStyleTag)?.label || "Personalizzato" : "Nessuno / personalizzato";
}

// Raw translated text (before style/quality/director tags get layered on),
// kept separately so the displayed prompt can be rebuilt instantly whenever
// the style or Director's Mode selection changes, without re-calling the
// translation API and without requiring the user to remember to press
// "Traduci & Ottimizza" again after tweaking the camera.
let lastSceneEn = null;
let lastNegAdditionEn = "";
// Separate from lastSceneEn: character-specific details (hair, eyes, scars,
// voice...) typed in step 1, distinct from the scene/action description in
// step 2. Both get translated on "Traduci & Ottimizza" and merged into the
// same positive prompt, character description first.
let lastCharacterDescEn = "";

// Quality/detail checkboxes and the aspect-ratio select, like the style
// select, carry their actual English prompt tag directly as the option/input
// value (see index.html) rather than a separate lookup table here.
function getQualityTags() {
  return qsa('#prompt-quality-options input[type="checkbox"]:checked').map((cb) => cb.value);
}

function setQualityTags(tags) {
  const wanted = new Set(tags || []);
  qsa('#prompt-quality-options input[type="checkbox"]').forEach((cb) => {
    cb.checked = wanted.has(cb.value);
  });
}

function getAspectRatioOption() {
  const select = qs("#prompt-aspect-ratio");
  const opt = select.options[select.selectedIndex];
  return {
    key: select.value,
    tag: opt?.dataset.tag || "",
    width: opt?.dataset.width ? Number(opt.dataset.width) : null,
    height: opt?.dataset.height ? Number(opt.dataset.height) : null,
  };
}

// Frame count / FPS only matter for animation workflows and only apply if
// the active workflow has them mapped (see workflows.js's "frameCount"/"fps"
// roles) — left blank, they're simply not sent and the workflow's own
// default values are used untouched.
function getFrameCount() {
  const value = qs("#prompt-frame-count").value.trim();
  return value ? Math.max(1, Math.round(Number(value))) : null;
}

function getFps() {
  const value = qs("#prompt-fps").value.trim();
  return value ? Math.max(1, Math.round(Number(value))) : null;
}

function updateDurationHint() {
  const frames = getFrameCount();
  const fps = getFps();
  const hint = qs("#prompt-duration-hint");
  hint.textContent = frames && fps ? `Durata stimata: ${(frames / fps).toFixed(1)}s (${frames} frame a ${fps} fps).` : "";
}

function saveDraft() {
  const draft = {
    sceneIt: qs("#prompt-input-it").value,
    negIt: qs("#prompt-input-neg-it").value,
    characterDescIt: qs("#prompt-character-desc-it").value,
    style: selectedStyleTag,
    qualityTags: getQualityTags(),
    aspectRatio: qs("#prompt-aspect-ratio").value,
    frameCount: qs("#prompt-frame-count").value,
    fps: qs("#prompt-fps").value,
    characterIdsByIndex: getSelectedCharacterIdsByIndex(),
    coherentMode: isCoherentModeOn(),
    coherentPreset: getCoherentPreset(),
    strengths: getStrengths(),
    outputEn: qs("#prompt-output-en").value,
    outputNegEn: qs("#prompt-output-neg-en").value,
    lastSceneEn,
    lastNegAdditionEn,
    lastCharacterDescEn,
  };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Pre-source-aware saves used a flat `characterIds` array (one entry per
// slot, by position) or, even older, a single `characterId`. Neither shape
// had pose slots, so array position lines up 1:1 with the current
// index-keyed shape — safe to convert directly.
function draftCharacterIdsByIndex(draft) {
  if (draft.characterIdsByIndex && typeof draft.characterIdsByIndex === "object") return draft.characterIdsByIndex;
  const arr = Array.isArray(draft.characterIds) ? draft.characterIds : draft.characterId ? [draft.characterId] : [];
  return Object.fromEntries(arr.map((id, index) => [index, id]));
}

function restoreDraft() {
  const draft = loadDraft();
  if (!draft) return;
  qs("#prompt-input-it").value = draft.sceneIt || "";
  qs("#prompt-input-neg-it").value = draft.negIt || "";
  qs("#prompt-character-desc-it").value = draft.characterDescIt || "";
  if (draft.style !== undefined) setSelectedStyle(draft.style);
  if (draft.aspectRatio !== undefined) qs("#prompt-aspect-ratio").value = draft.aspectRatio;
  setQualityTags(draft.qualityTags);
  qs("#prompt-frame-count").value = draft.frameCount || "";
  qs("#prompt-fps").value = draft.fps || "";
  updateDurationHint();
  qs("#prompt-coherent-mode-toggle").checked = !!draft.coherentMode;
  if (draft.coherentPreset !== undefined) qs("#prompt-coherent-preset").value = draft.coherentPreset;
  setStrengths(draft.strengths);
  qs("#prompt-output-en").value = draft.outputEn || "";
  qs("#prompt-output-neg-en").value = draft.outputNegEn || "";
  lastSceneEn = draft.lastSceneEn ?? null;
  lastNegAdditionEn = draft.lastNegAdditionEn || "";
  lastCharacterDescEn = draft.lastCharacterDescEn || "";

  setSelectedCharacterIdsByIndex(draftCharacterIdsByIndex(draft));
}

// Wipes every field of the "Crea Scena" flow (character selection, scene
// text, camera/director settings, generated prompt) back to a blank slate,
// including the persisted draft — so starting a new prompt never carries
// over leftovers from the previous one. Saved characters/workflows/scenes
// themselves are untouched, only the current in-progress draft.
function resetPromptForm() {
  qs("#prompt-input-it").value = "";
  qs("#prompt-input-neg-it").value = "";
  qs("#prompt-character-desc-it").value = "";
  setSelectedStyle("");
  setQualityTags([]);
  qs("#prompt-aspect-ratio").value = "";
  qs("#prompt-frame-count").value = "";
  qs("#prompt-fps").value = "";
  updateDurationHint();
  qs("#prompt-coherent-mode-toggle").checked = false;
  qs("#prompt-coherent-preset").selectedIndex = 0;
  setStrengths({ identity: 0.7, character: 0.7, pose: 0.7, faceCoherence: 0.7, costumeCoherence: 0.7, sceneFreedom: 0.6 });
  poseFile = null;
  qs("#prompt-pose-upload").value = "";
  renderPosePreview();
  setSelectedCharacterIdsByIndex({});
  lastSceneEn = null;
  lastNegAdditionEn = "";
  lastCharacterDescEn = "";
  qs("#prompt-output-en").value = "";
  qs("#prompt-output-neg-en").value = DEFAULT_NEGATIVE_EN;
  qs("#prompt-view-archive-btn").hidden = true;
  setSendStatus("");
  setFullDirectorState({});
  saveDraft();
  toast("Nuovo prompt: tutti i campi sono stati svuotati.", "info");
}

// --- Full prompt state (used by the saved-scenes archive) ---

export function getSceneDraftForSaving() {
  const characterIdsByIndex = getSelectedCharacterIdsByIndex();
  const characterNames = characterSlotDefs
    .map((slot, index) => (slot.source !== "pose" ? listCharacters().find((c) => c.id === characterIdsByIndex[index])?.name : null))
    .filter(Boolean);
  return {
    sceneIt: qs("#prompt-input-it").value,
    negIt: qs("#prompt-input-neg-it").value,
    characterDescIt: qs("#prompt-character-desc-it").value,
    style: selectedStyleTag,
    qualityTags: getQualityTags(),
    aspectRatio: qs("#prompt-aspect-ratio").value,
    frameCount: qs("#prompt-frame-count").value,
    fps: qs("#prompt-fps").value,
    characterIdsByIndex,
    characterNames,
    coherentMode: isCoherentModeOn(),
    coherentPreset: getCoherentPreset(),
    strengths: getStrengths(),
    outputEn: qs("#prompt-output-en").value,
    outputNegEn: qs("#prompt-output-neg-en").value,
    lastSceneEn,
    lastNegAdditionEn,
    lastCharacterDescEn,
  };
}

export function applySceneDraft(draft) {
  qs("#prompt-input-it").value = draft.sceneIt || "";
  qs("#prompt-input-neg-it").value = draft.negIt || "";
  qs("#prompt-character-desc-it").value = draft.characterDescIt || "";
  if (draft.style !== undefined) setSelectedStyle(draft.style);
  if (draft.aspectRatio !== undefined) qs("#prompt-aspect-ratio").value = draft.aspectRatio;
  setQualityTags(draft.qualityTags);
  qs("#prompt-frame-count").value = draft.frameCount || "";
  qs("#prompt-fps").value = draft.fps || "";
  updateDurationHint();
  qs("#prompt-coherent-mode-toggle").checked = !!draft.coherentMode;
  if (draft.coherentPreset !== undefined) qs("#prompt-coherent-preset").value = draft.coherentPreset;
  setStrengths(draft.strengths);
  lastSceneEn = draft.lastSceneEn ?? null;
  lastNegAdditionEn = draft.lastNegAdditionEn || "";
  lastCharacterDescEn = draft.lastCharacterDescEn || "";

  setSelectedCharacterIdsByIndex(draftCharacterIdsByIndex(draft));
  rebuildOutputs();
  saveDraft();
}

/**
 * Recomputes the displayed positive/negative prompt from the last translated
 * text plus the CURRENT style, Director's Mode tags, and (if "Personaggio
 * Coerente" is on) the auto-generated consistency block. Safe to call often
 * (style change, director tag change, right before sending) since it does
 * no network requests. No-op until a translation has happened at least once.
 */
function rebuildOutputs() {
  if (lastSceneEn === null) return;
  const style = selectedStyleTag;
  const directorTags = getAppliedDirectorTags();
  const qualityTags = getQualityTags();
  const aspectTag = getAspectRatioOption().tag;
  const extraTags = [...directorTags, ...qualityTags];
  if (aspectTag) extraTags.push(aspectTag);

  if (isCoherentModeOn()) {
    const presetTag = COHERENT_MODE_PRESETS.find((p) => p.key === getCoherentPreset())?.tag;
    if (presetTag) extraTags.push(presetTag);
    const { identityActive, characterActive, poseActive } = getActiveConsistencySources();
    const block = buildConsistencyBlock({ identityActive, characterActive, poseActive, strengths: getStrengths() });
    if (block) extraTags.push(block);
  }

  // Character details (step 1) come first, then the scene/action description
  // (step 2) — both get tag-optimized and merged into a single prompt.
  const sceneText = lastCharacterDescEn ? `${lastCharacterDescEn}. ${lastSceneEn}` : lastSceneEn;
  const positive = optimizePrompt(sceneText, { style, extraTags });
  qs("#prompt-output-en").value = positive;
  lastGenerated.positive = positive;

  const negative = tagify(DEFAULT_NEGATIVE_EN, lastNegAdditionEn ? [lastNegAdditionEn] : []);
  qs("#prompt-output-neg-en").value = negative;
  lastGenerated.negative = negative;

  saveDraft();
}

// One reference-image "slot" per mapped LoadImage-type node in the active
// workflow. Each slot has a SOURCE — "character" (body/costume, the
// original behavior), "identity" (face close-up), or "pose" (pose/action
// guide only) — set per-node in the Workflow tab's mapping panel. This is
// what makes "3 characters together in one shot" AND "identity vs
// body-costume vs pose-only reference" both possible at once: identity/
// character slots each get their own character picker (any of them can
// point at the SAME or a DIFFERENT saved character); pose slots share a
// single ephemeral upload instead, since a pose reference is typically a
// one-off image with no bearing on any specific character's identity. In
// external-AI mode (or when the active workflow has no image mapping
// configured yet) there's exactly one generic "character" slot, matching
// the original single-character UX.
let characterSlotDefs = [{ label: "Personaggio di riferimento", source: "character", nodeId: null, field: null }];
let poseFile = null; // ephemeral: never persisted to the draft/scene (can't be, and it's meant to be swapped per scene)

function computeCharacterSlotDefs(workflow) {
  if (getGenerationMode() === "external") {
    return [{ label: "Personaggio di riferimento", source: "character", nodeId: null, field: null }];
  }
  const mapping = workflow?.mapping || {};
  const imageMappings = Array.isArray(mapping.images) ? mapping.images : mapping.image ? [mapping.image] : [];
  if (imageMappings.length === 0) {
    return [{ label: "Personaggio di riferimento", source: "character", nodeId: null, field: null }];
  }
  const sourceLabels = { identity: "Identità (volto)", pose: "Posa", character: "Personaggio (corpo/costume)" };
  return imageMappings.map((m, index) => {
    const source = m.source || "character";
    const sourceLabel = sourceLabels[source] || sourceLabels.character;
    const label = m.label ? `${m.label} — ${sourceLabel}` : workflow?.json?.[m.nodeId]?._meta?.title || `${sourceLabel} ${index + 1} (nodo #${m.nodeId})`;
    return { label, source, nodeId: m.nodeId, field: m.field };
  });
}

function getSelectedCharacterIdsByIndex() {
  const map = {};
  qsa("select[data-slot-index]", qs("#prompt-character-slots")).forEach((select) => {
    map[Number(select.dataset.slotIndex)] = select.value;
  });
  return map;
}

function setSelectedCharacterIdsByIndex(idsByIndex) {
  qsa("select[data-slot-index]", qs("#prompt-character-slots")).forEach((select) => {
    const id = idsByIndex?.[Number(select.dataset.slotIndex)] || "";
    select.value = id && [...select.options].some((o) => o.value === id) ? id : "";
    const previewDiv = select.closest("label")?.querySelector(".char-slot-preview");
    if (previewDiv) renderCharacterSlotPreview(previewDiv, select.value);
  });
  updateCharacterHint();
  renderMappingSummary();
}

// Which of identity/character/pose will ACTUALLY have a real file attached
// this generation — used both by the auto consistency block (never mention
// a source that isn't really in play) and the pre-send summary panel.
function getActiveConsistencySources() {
  const idsByIndex = getSelectedCharacterIdsByIndex();
  let identityActive = false;
  let characterActive = false;
  let poseActive = false;
  characterSlotDefs.forEach((slot, index) => {
    if (slot.source === "pose") {
      if (poseFile) poseActive = true;
      return;
    }
    const character = listCharacters().find((c) => c.id === idsByIndex[index]);
    if (!character) return;
    if (slot.source === "identity") identityActive = true;
    else characterActive = true;
  });
  return { identityActive, characterActive, poseActive };
}

function updateCharacterHint() {
  const hint = qs("#prompt-character-hint");
  const idsByIndex = getSelectedCharacterIdsByIndex();
  const chosen = characterSlotDefs
    .map((slot, index) => ({ slot, character: listCharacters().find((c) => c.id === idsByIndex[index]) }))
    .filter((entry) => entry.slot.source !== "pose" && entry.character);
  const hasPoseSlot = characterSlotDefs.some((s) => s.source === "pose");
  const poseNote = hasPoseSlot ? (poseFile ? " Posa: immagine caricata." : " Posa: nessuna immagine caricata (facoltativa).") : "";

  if (chosen.length > 0) {
    const parts = chosen.map((entry) => `${entry.slot.label}: "${entry.character.name}"`);
    hint.textContent = `✅ Userò ${parts.join(", ")} come riferimento.${poseNote}`;
    hint.className = "status-box full ok";
  } else if (listCharacters().length > 0) {
    hint.textContent = `⚠️ Nessun personaggio selezionato: l'immagine generata non avrà un aspetto coerente con nessuno dei tuoi personaggi.${poseNote}`;
    hint.className = "status-box full error";
  } else {
    hint.textContent = "Carica un personaggio nella scheda 'Personaggi' per mantenerne l'aspetto coerente nelle immagini generate.";
    hint.className = "status-box full";
  }
}

// Small thumbnail next to a character-slot picker so it's clear at a glance
// which saved character is about to be used, without leaving "Crea Scena" —
// reuses the same blurred/eye-toggle privacy control as the character grid,
// and toggling it here updates the character's saved visibility everywhere.
// One tracked object URL per slot's own container (not a shared tracker):
// several slots can be on screen at once, and re-rendering one slot must
// never revoke a URL a different, unchanged slot is still displaying.
function renderCharacterSlotPreview(container, characterId) {
  if (container._objectUrl) {
    URL.revokeObjectURL(container._objectUrl);
    container._objectUrl = null;
  }
  container.innerHTML = "";
  const character = listCharacters().find((c) => c.id === characterId);
  if (!character) return;
  const url = URL.createObjectURL(character.blob);
  container._objectUrl = url;
  const isHidden = character.visible === false;
  container.appendChild(
    thumbWithPrivacyToggle(url, character.name, isHidden, () => setCharacterVisibility(character.id, isHidden))
  );
}

let posePreviewUrl = null;

function renderPosePreview() {
  if (posePreviewUrl) {
    URL.revokeObjectURL(posePreviewUrl);
    posePreviewUrl = null;
  }
  const root = qs("#prompt-pose-preview");
  root.innerHTML = "";
  if (!poseFile) return;
  const url = URL.createObjectURL(poseFile);
  posePreviewUrl = url;
  root.appendChild(
    el("div", { class: "row" }, [
      el("img", { src: url, alt: "Posa", class: "pose-preview-thumb" }),
      el(
        "button",
        {
          class: "btn small danger",
          type: "button",
          onclick: () => {
            poseFile = null;
            qs("#prompt-pose-upload").value = "";
            renderPosePreview();
            updateCharacterHint();
            renderMappingSummary();
          },
        },
        "Rimuovi posa"
      ),
    ])
  );
}

// Requirement: show source/node/field/assigned-file BEFORE sending, so
// mapping mistakes are visible instead of discovered from a ComfyUI error.
function renderMappingSummary() {
  const root = qs("#prompt-mapping-summary");
  root.innerHTML = "";
  if (!characterSlotDefs.some((s) => s.nodeId)) return; // external mode / no image mapping configured: nothing concrete to show

  const idsByIndex = getSelectedCharacterIdsByIndex();
  const sourceLabels = { identity: "Identità", pose: "Posa", character: "Personaggio" };
  const rows = [];
  characterSlotDefs.forEach((slot, index) => {
    if (!slot.nodeId) return;
    let filename = "— non impostata —";
    if (slot.source === "pose") {
      filename = poseFile ? poseFile.name : "— nessuna (facoltativa: nodo non impostato) —";
    } else {
      const character = listCharacters().find((c) => c.id === idsByIndex[index]);
      if (character) {
        filename = slot.source === "identity" && character.identityBlob ? `${character.name} (foto identità)` : `${character.name} (foto personaggio)`;
      }
    }
    rows.push({ sourceLabel: sourceLabels[slot.source] || sourceLabels.character, nodeId: slot.nodeId, field: slot.field, filename });
  });
  if (rows.length === 0) return;

  root.appendChild(el("div", { class: "step-title" }, "📋 Riepilogo mappatura (prima dell'invio)"));
  root.appendChild(
    el("table", { class: "mapping-summary-table" }, [
      el("thead", {}, [el("tr", {}, [el("th", {}, "Sorgente"), el("th", {}, "Nodo"), el("th", {}, "Campo"), el("th", {}, "File assegnato")])]),
      el(
        "tbody",
        {},
        rows.map((r) => el("tr", {}, [el("td", {}, r.sourceLabel), el("td", {}, `#${r.nodeId}`), el("td", {}, r.field), el("td", {}, r.filename)]))
      ),
    ])
  );
}

function isCoherentModeOn() {
  return qs("#prompt-coherent-mode-toggle").checked;
}

function getCoherentPreset() {
  return qs("#prompt-coherent-preset").value;
}

function getStrengths() {
  const read = (selector) => Number(qs(selector).value) / 100;
  return {
    identity: read("#prompt-strength-identity"),
    character: read("#prompt-strength-character"),
    pose: read("#prompt-strength-pose"),
    faceCoherence: read("#prompt-strength-face-coherence"),
    costumeCoherence: read("#prompt-strength-costume-coherence"),
    sceneFreedom: read("#prompt-strength-scene-freedom"),
  };
}

function setStrengths(strengths) {
  const selectors = {
    identity: "#prompt-strength-identity",
    character: "#prompt-strength-character",
    pose: "#prompt-strength-pose",
    faceCoherence: "#prompt-strength-face-coherence",
    costumeCoherence: "#prompt-strength-costume-coherence",
    sceneFreedom: "#prompt-strength-scene-freedom",
  };
  for (const [key, selector] of Object.entries(selectors)) {
    if (strengths && typeof strengths[key] === "number") {
      qs(selector).value = String(Math.round(strengths[key] * 100));
    }
  }
}

function populateCoherentPresetOptions() {
  const select = qs("#prompt-coherent-preset");
  select.innerHTML = "";
  for (const preset of COHERENT_MODE_PRESETS) {
    select.appendChild(el("option", { value: preset.key }, preset.label));
  }
}

// Frame count/FPS only do anything if the active workflow actually has them
// mapped — hide the whole "Animazione" section otherwise instead of showing
// controls that would silently have no effect.
function updateAnimationSectionVisibility(workflow) {
  const hasAnimationMapping = !!(workflow?.mapping?.frameCount || workflow?.mapping?.fps);
  qs("#prompt-animation-section").hidden = !hasAnimationMapping;
}

async function renderCharacterSlots() {
  const workflow = getGenerationMode() === "external" ? null : await getActiveWorkflow();
  characterSlotDefs = computeCharacterSlotDefs(workflow);
  updateAnimationSectionVisibility(workflow);

  const container = qs("#prompt-character-slots");
  const previousIds = getSelectedCharacterIdsByIndex();
  const isFirstRender = container.childElementCount === 0;
  container.innerHTML = "";

  characterSlotDefs.forEach((slot, index) => {
    if (slot.source === "pose") {
      container.appendChild(
        el(
          "p",
          { class: "hint small full" },
          `${slot.label}: usa il caricamento "Riferimento posa" qui sotto — non è legato a un personaggio salvato.`
        )
      );
      return;
    }
    const previewDiv = el("div", { class: "char-slot-preview" });
    const select = el(
      "select",
      {
        "data-slot-index": String(index),
        onchange: () => {
          updateCharacterHint();
          renderMappingSummary();
          saveDraft();
          renderCharacterSlotPreview(previewDiv, select.value);
          renderCopyReferenceButtons();
        },
      },
      [el("option", { value: "" }, "— nessuno —"), ...listCharacters().map((c) => el("option", { value: c.id }, c.name))]
    );
    const previous = previousIds[index];
    if (previous && [...select.options].some((o) => o.value === previous)) {
      select.value = previous;
    } else if (isFirstRender && index === 0 && !previous && listCharacters().length > 0) {
      // Nothing was explicitly chosen yet: default the first slot to the most
      // recently added character instead of silently generating with none.
      select.value = listCharacters()[0].id;
    }
    renderCharacterSlotPreview(previewDiv, select.value);
    container.appendChild(el("label", { class: "full" }, [slot.label, select, previewDiv]));
  });

  updateCharacterHint();
  renderMappingSummary();
  renderCopyReferenceButtons();
}

// "Copia foto riferimento" buttons for Opzione B (copy-and-paste generation,
// step 5) — one per currently-selected character slot, so the exact same
// reference image ComfyUI would have used is one tap away to paste into an
// external AI's chat, without a detour to the Personaggi tab. Pose slots are
// skipped: that file came straight from the user's own upload, so they
// already have it.
let copyReferenceRenderToken = 0;
async function renderCopyReferenceButtons() {
  const container = qs("#prompt-copy-reference-list");
  if (!container) return;

  // Multiple slot dropdowns can fire "change" in quick succession (e.g. two
  // slots defaulting/updating together) — each triggers its own call to this
  // async function. Without this token, an earlier call's awaits could still
  // be resolving when a newer call finishes and clears+rebuilds the
  // container first, so the earlier call's leftover appends land afterwards
  // on top of it, doubling up buttons. A superseded call just bails instead.
  const token = ++copyReferenceRenderToken;
  const idsByIndex = getSelectedCharacterIdsByIndex();
  const entries = [];
  for (let index = 0; index < characterSlotDefs.length; index++) {
    const slot = characterSlotDefs[index];
    if (slot.source === "pose") continue;
    const characterId = idsByIndex[index];
    if (!characterId) continue;
    const character = await getCharacterById(characterId);
    if (token !== copyReferenceRenderToken) return; // a newer call took over meanwhile
    if (!character) continue;
    const useIdentityBlob = slot.source === "identity" && !!character.identityBlob;
    entries.push({ label: characterSlotDefs.length > 1 ? slot.label : "foto riferimento", blob: useIdentityBlob ? character.identityBlob : character.blob });
  }
  if (token !== copyReferenceRenderToken) return;

  container.innerHTML = "";
  if (entries.length === 0) {
    container.appendChild(el("p", { class: "hint small" }, "Scegli un personaggio al passo 1 per poter copiare qui la sua foto."));
    return;
  }
  for (const entry of entries) {
    container.appendChild(
      el(
        "button",
        { type: "button", class: "btn small", onclick: () => handleCopyReferenceImage(entry.blob, entry.label) },
        `📋 Copia ${entry.label}`
      )
    );
  }
}

async function handleCopyReferenceImage(blob, label) {
  const ok = await copyImageToClipboard(blob);
  toast(ok ? `Foto (${label}) copiata: incollala nell'IA.` : "Copia immagine non riuscita (browser non supportato).", ok ? "success" : "error");
}

function setSendStatus(message, type = "") {
  const box = qs("#prompt-send-status");
  box.textContent = message;
  box.className = `status-box${type ? " " + type : ""}`;
}

async function handleTranslate() {
  const sceneIt = qs("#prompt-input-it").value.trim();
  const negIt = qs("#prompt-input-neg-it").value.trim();
  const characterDescIt = qs("#prompt-character-desc-it").value.trim();

  if (!sceneIt) {
    toast("Inserisci prima una descrizione della scena.", "error");
    return;
  }

  const btn = qs("#prompt-translate-btn");
  btn.disabled = true;
  btn.textContent = "Traduzione in corso...";

  try {
    const { text: sceneEn, source } = await translateItToEn(sceneIt);
    lastSceneEn = sceneEn;
    lastNegAdditionEn = negIt ? (await translateItToEn(negIt)).text : "";
    lastCharacterDescEn = characterDescIt ? (await translateItToEn(characterDescIt)).text : "";
    rebuildOutputs();

    toast(
      source === "api" ? "Prompt tradotto e ottimizzato." : "Tradotto con dizionario locale (API non raggiungibile).",
      source === "api" ? "success" : "info"
    );
  } catch (err) {
    toast(`Errore durante la traduzione: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Traduci & Ottimizza";
  }
}

// Both rewrite the STORED English text (lastSceneEn/lastCharacterDescEn),
// not the rendered #prompt-output-en directly — anything that later calls
// rebuildOutputs() (style change, director tags, quality checkboxes...)
// fully recomputes that field from those two variables, so an edit made
// only to the rendered textarea would silently vanish on the next tweak.
function handleAvoidRefusal() {
  if (lastSceneEn === null) {
    toast("Traduci prima il prompt (Traduci & Ottimizza).", "error");
    return;
  }
  const scene = optimizeForAiAcceptance(lastSceneEn);
  const desc = optimizeForAiAcceptance(lastCharacterDescEn);
  lastSceneEn = scene.text;
  lastCharacterDescEn = desc.text;
  rebuildOutputs();
  const matched = scene.matched || desc.matched;
  toast(
    matched ? "Prompt riformulato per ridurre i rifiuti dell'IA." : "Nessun termine problematico trovato: prompt lasciato invariato.",
    matched ? "success" : "info"
  );
}

function handleCopyrightSafe() {
  if (lastSceneEn === null) {
    toast("Traduci prima il prompt (Traduci & Ottimizza).", "error");
    return;
  }
  const scene = optimizeForCopyrightSafety(lastSceneEn);
  const desc = optimizeForCopyrightSafety(lastCharacterDescEn);
  lastSceneEn = scene.text;
  lastCharacterDescEn = desc.text;
  rebuildOutputs();
  const matched = scene.matched || desc.matched;
  toast(
    matched
      ? "Personaggio protetto sostituito con una descrizione simile ma generica."
      : "Nessun personaggio protetto riconosciuto: se l'IA rifiuta comunque, prova a descriverne l'aspetto invece del nome.",
    matched ? "success" : "info"
  );
}

// Entry point for other modules that produce a ready-made ENGLISH prompt
// outside this file's own IT->EN translate step (currently: imageanalysis.js's
// "Immagine → Prompt"). Sets lastSceneEn directly instead of going through
// translateItToEn — re-translating already-English text would garble it —
// so all the normal downstream behavior (style/quality/director tags via
// rebuildOutputs, later edits surviving rebuilds) still applies from here on.
export function loadPromptFromExternalText(englishText, { referenceCharacterId } = {}) {
  lastSceneEn = englishText;
  lastCharacterDescEn = "";
  lastNegAdditionEn = "";
  rebuildOutputs();

  let referenceApplied = false;
  if (referenceCharacterId) {
    const select = qs('#prompt-character-slots select[data-slot-index="0"]');
    if (select && [...select.options].some((o) => o.value === referenceCharacterId)) {
      select.value = referenceCharacterId;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      referenceApplied = true;
    }
  }

  window.dispatchEvent(new CustomEvent("request-tab", { detail: "tab-prompt" }));
  toast(
    referenceApplied
      ? "Prompt caricato in Crea Scena — personaggio di riferimento selezionato anche al passo 1."
      : "Prompt caricato in Crea Scena.",
    "success"
  );
}

async function handleCopy(sourceId, label) {
  const value = qs(`#${sourceId}`).value;
  if (!value) {
    toast(`Nessun ${label} da copiare.`, "error");
    return;
  }
  const ok = await copyToClipboard(value);
  toast(ok ? `${label} copiato negli appunti.` : "Copia non riuscita.", ok ? "success" : "error");
}

function updateCopyOpenButton() {
  const meta = getProviderMeta(getActiveProvider());
  qs("#prompt-copy-open-btn").textContent = `📋🔗 Copia prompt e apri ${meta?.label || "IA"}`;
}

async function handleCopyAndOpen() {
  const positive = qs("#prompt-output-en").value.trim();
  if (!positive) {
    toast("Genera prima il prompt (Traduci & Ottimizza).", "error");
    return;
  }
  const negative = qs("#prompt-output-neg-en").value.trim();
  const combined = negative ? `${positive}\n\nDa evitare: ${negative}` : positive;

  const meta = getProviderMeta(getActiveProvider());
  const ok = await copyToClipboard(combined);
  if (!ok) {
    toast("Copia non riuscita.", "error");
    return;
  }
  if (meta?.consumerAppUrl) window.open(meta.consumerAppUrl, "_blank", "noopener");
  toast(`Prompt copiato. Ho aperto ${meta?.label || "l'IA"}: incolla il testo, poi l'immagine del personaggio.`, "success");
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function handleSendLocal(positive, negative) {
  const settings = getConnectionSettings();
  if (!settings) {
    setSendStatus("Configura prima la connessione a ComfyUI nella scheda 'Connessione ComfyUI'.", "error");
    return;
  }

  const workflow = await getActiveWorkflow();
  if (!workflow) {
    setSendStatus("Seleziona un workflow attivo nella scheda 'Workflow'.", "error");
    return;
  }

  const client = new ComfyUIClient(settings);
  const graph = deepClone(workflow.json);
  const mapping = workflow.mapping || {};

  // Some workflows have several prompt-text nodes (e.g. custom nodes like
  // TextEncodeQwenImageEdit/TextEncodeQwenImageEditPlus alongside a regular
  // CLIPTextEncode, or multiple stages of the same node) that all need the
  // same prompt text — mapping.positives/negatives are arrays; the old
  // singular mapping.positive/negative is kept for workflows mapped before
  // multi-node support was added.
  const positiveMappings = Array.isArray(mapping.positives) ? mapping.positives : mapping.positive ? [mapping.positive] : [];
  for (const m of positiveMappings) {
    graph[m.nodeId].inputs[m.field] = positive;
  }
  const negativeMappings = Array.isArray(mapping.negatives) ? mapping.negatives : mapping.negative ? [mapping.negative] : [];
  for (const m of negativeMappings) {
    graph[m.nodeId].inputs[m.field] = negative;
  }
  if (mapping.seed) {
    graph[mapping.seed.nodeId].inputs[mapping.seed.field] = Math.floor(Math.random() * 1e15);
  }
  if (mapping.resolution) {
    const aspect = getAspectRatioOption();
    if (aspect.width && aspect.height) {
      graph[mapping.resolution.nodeId].inputs[mapping.resolution.widthField] = aspect.width;
      graph[mapping.resolution.nodeId].inputs[mapping.resolution.heightField] = aspect.height;
    }
  }
  if (mapping.frameCount) {
    const frames = getFrameCount();
    if (frames) graph[mapping.frameCount.nodeId].inputs[mapping.frameCount.field] = frames;
  }
  if (mapping.fps) {
    const fps = getFps();
    if (fps) graph[mapping.fps.nodeId].inputs[mapping.fps.field] = fps;
  }

  // Some workflows have several LoadImage nodes that each need a DIFFERENT
  // reference image — up to 3 distinct characters combined in one shot, AND/OR
  // separate identity (face) / character (body-costume) / pose-only
  // references for the SAME character. Each entry in `mapping.images`
  // corresponds 1:1, in order, to a slot rendered in "1. Personaggio" by
  // renderCharacterSlots(). `mapping.image` (singular) is kept for workflows
  // mapped before multi-node support was added; it always pairs with a
  // single "character"-source slot.
  const imageMappings = Array.isArray(mapping.images) ? mapping.images : mapping.image ? [mapping.image] : [];
  if (imageMappings.length > 0) {
    const idsByIndex = getSelectedCharacterIdsByIndex();
    // Keyed per (character, role) — NOT just per character — so a
    // character's identity photo and body/costume photo, which are
    // different files, are never uploaded under the same name and one
    // silently overwriting the other on ComfyUI's server.
    const uploadedByKey = new Map();
    let statusShown = false;

    for (let index = 0; index < imageMappings.length; index++) {
      const imageMapping = imageMappings[index];
      const source = imageMapping.source || "character";

      if (source === "pose") {
        // Optional: if nothing was uploaded this scene, leave the node's
        // existing value untouched — never send an empty filename.
        if (!poseFile) continue;
        let uploaded = uploadedByKey.get("pose");
        if (!uploaded) {
          if (!statusShown) { setSendStatus("Caricamento immagini di riferimento su ComfyUI..."); statusShown = true; }
          const result = await client.uploadImage(poseFile, "pose-reference.png");
          uploaded = result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
          uploadedByKey.set("pose", uploaded);
        }
        graph[imageMapping.nodeId].inputs[imageMapping.field] = uploaded;
        continue;
      }

      const characterId = idsByIndex[index];
      if (!characterId) continue; // slot left empty on purpose: leave that node's existing value untouched
      const character = await getCharacterById(characterId);
      if (!character) continue;
      const useIdentityBlob = source === "identity" && !!character.identityBlob;
      const blob = useIdentityBlob ? character.identityBlob : character.blob;
      const uploadKey = `${characterId}:${useIdentityBlob ? "identity" : "character"}`;
      let uploaded = uploadedByKey.get(uploadKey);
      if (!uploaded) {
        if (!statusShown) { setSendStatus("Caricamento immagini di riferimento su ComfyUI..."); statusShown = true; }
        // Spaces/odd characters in the filename have caused ComfyUI's LoadImage
        // node to fail to find the file it was just given; a plain
        // alphanumeric name sidesteps any such filesystem/parsing ambiguity.
        const safeId = character.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
        const safeName = useIdentityBlob ? `identity-${safeId}.png` : `char-${safeId}.png`;
        const result = await client.uploadImage(blob, safeName);
        uploaded = result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
        uploadedByKey.set(uploadKey, uploaded);
      }
      graph[imageMapping.nodeId].inputs[imageMapping.field] = uploaded;
    }
  }

  setSendStatus("Invio del workflow a ComfyUI...");
  const queued = await client.queuePrompt(graph, sessionClientId);
  if (queued.node_errors && Object.keys(queued.node_errors).length > 0) {
    throw new ComfyUIError(`Errori nei nodi del workflow: ${JSON.stringify(queued.node_errors)}`);
  }

  setSendStatus("Generazione in corso su ComfyUI, attendere...");
  // Server-side progress events aren't guaranteed on every ComfyUI setup (they
  // can arrive late, not at all for some node types, or get lost if the socket
  // reconnects) — a local elapsed-time tick keeps the status visibly moving
  // even with no percentage yet, so a slow/complex generation doesn't look
  // stuck when it's actually still running.
  const genStartedAt = Date.now();
  let lastProgress = null;
  const tickTimer = setInterval(() => {
    const elapsedSec = Math.round((Date.now() - genStartedAt) / 1000);
    const elapsed = elapsedSec < 60 ? `${elapsedSec}s` : `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`;
    if (lastProgress && lastProgress.max > 0) {
      const pct = Math.round((lastProgress.value / lastProgress.max) * 100);
      setSendStatus(`Generazione in corso su ComfyUI... ${pct}% (passo ${lastProgress.value}/${lastProgress.max}) · ${elapsed}`);
    } else {
      setSendStatus(`Generazione in corso su ComfyUI... ${elapsed} (i workflow complessi possono richiedere diversi minuti)`);
    }
  }, 1000);

  let images;
  try {
    images = await client.waitForResult(queued.prompt_id, sessionClientId, {
      timeoutMs: 20 * 60 * 1000,
      onProgress: (p) => {
        lastProgress = p;
      },
    });
  } finally {
    clearInterval(tickTimer);
  }

  if (images.length === 0) {
    setSendStatus("Generazione completata ma nessuna immagine restituita.", "error");
    return;
  }

  for (const imageRef of images) {
    const blob = await client.fetchImageBlob(imageRef);
    // Keep ComfyUI's real filename/extension (png, gif, mp4, webm...) so the
    // archive can tell a still image from an animation/video and download it
    // with a working extension, instead of assuming everything is a .png.
    await addArchiveImage(blob, {
      name: imageRef.filename.replace(/\.[^/.]+$/, ""),
      filename: imageRef.filename,
      prompt: positive,
      workflowName: workflow.name,
    });
  }
  refreshArchive();
  setSendStatus(`✅ ${images.length} file generati e salvati in archivio (ComfyUI).`, "ok");
  toast("Generazione completata.", "success");
  qs("#prompt-view-archive-btn").hidden = false;
}

async function handleSendExternal(positive, negative) {
  const providerId = getActiveProvider();
  const meta = getProviderMeta(providerId);
  const settings = getProviderSettings(providerId);
  if (!settings?.apiKey) {
    setSendStatus(`Inserisci la API key di ${meta?.label || providerId} nella scheda 'IA Esterne'.`, "error");
    return;
  }

  let referenceBlob = null;
  // External providers only support one reference image, and external mode
  // always renders exactly one character slot (see computeCharacterSlotDefs).
  const characterId = getSelectedCharacterIdsByIndex()[0];
  if (characterId) {
    if (!meta?.supportsReferenceImage) {
      setSendStatus(`${meta?.label || providerId} non supporta ancora l'immagine di riferimento: genero solo da testo.`, "");
    } else {
      const character = await getCharacterById(characterId);
      referenceBlob = character?.blob || null;
    }
  }

  setSendStatus(`Generazione in corso con ${meta?.label || providerId}, attendere...`);
  const blobs = await generateImageExternal({ provider: providerId, settings, positive, negative, referenceBlob });

  for (const blob of blobs) {
    await addArchiveImage(blob, { name: `${providerId}-${Date.now()}`, prompt: positive, workflowName: `IA esterna: ${meta?.label || providerId}` });
  }
  refreshArchive();
  setSendStatus(`✅ ${blobs.length} immagine/i generate e salvate in archivio (${meta?.label || providerId}).`, "ok");
  toast("Generazione completata.", "success");
  qs("#prompt-view-archive-btn").hidden = false;
}

async function handleSend() {
  rebuildOutputs(); // safety net: pick up any camera/style change even if the user didn't re-translate
  const positive = qs("#prompt-output-en").value.trim();
  if (!positive) {
    toast("Genera prima il prompt (Traduci & Ottimizza).", "error");
    return;
  }
  const negative = qs("#prompt-output-neg-en").value.trim();

  const sendBtn = qs("#prompt-send-btn");
  sendBtn.disabled = true;
  qs("#prompt-view-archive-btn").hidden = true;
  setSendStatus("Preparazione della richiesta...");

  try {
    if (getGenerationMode() === "external") {
      await handleSendExternal(positive, negative);
    } else {
      await handleSendLocal(positive, negative);
    }
  } catch (err) {
    const message = err instanceof ComfyUIError || err instanceof ProviderError ? err.message : `Errore imprevisto: ${err.message}`;
    setSendStatus(message, "error");
    toast(message, "error");
  } finally {
    sendBtn.disabled = false;
  }
}

function updateModeIndicator() {
  const mode = getGenerationMode();
  const indicator = qs("#prompt-mode-indicator");
  const sendBtn = qs("#prompt-send-btn");
  if (mode === "external") {
    const meta = getProviderMeta(getActiveProvider());
    indicator.textContent = `☁️ Modalità IA Esterna — provider attivo: ${meta?.label || "nessuno selezionato"} (configuralo nella scheda 'IA Esterne').`;
    sendBtn.textContent = `🚀 Genera con ${meta?.label || "IA esterna"}`;
  } else {
    indicator.textContent = "🖥️ Modalità ComfyUI locale — usa il workflow attivo configurato nella scheda 'Workflow'.";
    sendBtn.textContent = "🚀 Invia a ComfyUI";
  }
  updateCopyOpenButton();
}

export async function initPrompts() {
  populateCoherentPresetOptions();
  await renderCharacterSlots();
  restoreDraft();
  const negField = qs("#prompt-output-neg-en");
  if (!negField.value.trim()) negField.value = DEFAULT_NEGATIVE_EN;
  window.addEventListener("characters-updated", renderCharacterSlots);
  // Any of these can change how many reference-image slots should exist (a
  // different workflow has a different number of mapped LoadImage nodes, its
  // mapping was just edited, or switching to external-AI mode collapses back
  // to a single generic slot). "active-workflow-updated" is state.js's own
  // pub/sub (not a window event), so it's wired through onStateChange.
  onStateChange((event) => {
    if (event === "active-workflow-updated") renderCharacterSlots();
  });
  window.addEventListener("workflow-mapping-updated", renderCharacterSlots);
  window.addEventListener("generation-mode-ui-updated", renderCharacterSlots);
  window.addEventListener("generation-mode-ui-updated", updateModeIndicator);
  window.addEventListener("storage", updateModeIndicator);
  updateModeIndicator();

  qs("#prompt-translate-btn").addEventListener("click", handleTranslate);
  qs("#prompt-avoid-refusal-btn").addEventListener("click", handleAvoidRefusal);
  qs("#prompt-copyright-safe-btn").addEventListener("click", handleCopyrightSafe);
  qs("#prompt-reset-btn").addEventListener("click", resetPromptForm);
  qs("#prompt-copy-btn").addEventListener("click", () => handleCopy("prompt-output-en", "Prompt"));
  qs("#prompt-copy-neg-btn").addEventListener("click", () => handleCopy("prompt-output-neg-en", "Prompt negativo"));
  qs("#prompt-send-btn").addEventListener("click", handleSend);
  qs("#prompt-view-archive-btn").addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("request-tab", { detail: "tab-archive" }));
  });
  qs("#prompt-copy-open-btn").addEventListener("click", handleCopyAndOpen);
  qs("#prompt-input-it").addEventListener("input", saveDraft);
  qs("#prompt-input-neg-it").addEventListener("input", saveDraft);
  qs("#prompt-character-desc-it").addEventListener("input", saveDraft);
  qs("#prompt-style-edit-btn").addEventListener("click", () => {
    openPickerModal({
      title: "Scegli lo stile",
      groups: [{ title: "—", options: [{ key: "none", label: "Nessuno / personalizzato", tag: "", description: "Nessuno stile aggiunto: usa solo la descrizione della scena.", icon: "" }] }, ...STYLE_GROUPS],
      currentTag: selectedStyleTag,
      onSelect: (option) => {
        setSelectedStyle(option.tag);
        rebuildOutputs();
      },
    });
  });
  qs("#prompt-aspect-ratio").addEventListener("change", rebuildOutputs);
  qsa('#prompt-quality-options input[type="checkbox"]').forEach((cb) => cb.addEventListener("change", rebuildOutputs));
  qs("#prompt-frame-count").addEventListener("input", () => { updateDurationHint(); saveDraft(); });
  qs("#prompt-fps").addEventListener("input", () => { updateDurationHint(); saveDraft(); });
  window.addEventListener("director-tags-updated", rebuildOutputs);

  qs("#prompt-pose-upload").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) {
      poseFile = file;
      renderPosePreview();
      updateCharacterHint();
      renderMappingSummary();
      rebuildOutputs();
    }
  });
  qs("#prompt-coherent-mode-toggle").addEventListener("change", rebuildOutputs);
  qs("#prompt-coherent-preset").addEventListener("change", rebuildOutputs);
  [
    "#prompt-strength-identity",
    "#prompt-strength-character",
    "#prompt-strength-pose",
    "#prompt-strength-face-coherence",
    "#prompt-strength-costume-coherence",
    "#prompt-strength-scene-freedom",
  ].forEach((selector) => qs(selector).addEventListener("input", rebuildOutputs));

  initVoiceDictation("prompt-input-it", "prompt-input-it-mic");
  initVoiceDictation("prompt-input-neg-it", "prompt-input-neg-it-mic");
  initVoiceDictation("prompt-character-desc-it", "prompt-character-desc-it-mic");

  // Re-check indicator whenever the user switches to the Prompt tab or changes active provider.
  document.querySelectorAll('.tab-btn[data-tab="tab-prompt"]').forEach((btn) =>
    btn.addEventListener("click", updateModeIndicator)
  );
  document.querySelectorAll('input[name="active-provider"]').forEach((radio) =>
    radio.addEventListener("change", updateModeIndicator)
  );
}
