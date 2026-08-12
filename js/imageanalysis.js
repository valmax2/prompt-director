import { qs, el, toast, copyToClipboard, copyImageToClipboard, createObjectUrlTracker } from "./utils.js";
import { getProviderSettings, getActiveProvider } from "./state.js";
import { listCharacters, getCharacterById } from "./characters.js";
import { blobToBase64, readErrorText, getProviderMeta, ProviderError } from "./providers.js";
import { loadPromptFromExternalText } from "./prompts.js";

// Uses Gemini's vision understanding, not its image-generation endpoint —
// a separate model from whatever the user configured for image generation
// in "IA Esterne", since a generation-tuned model isn't necessarily good at
// (or even capable of) plain image description. Same API key either way.
const VISION_MODEL = "gemini-2.5-flash";

const BASE_INSTRUCTION =
  "Describe this image in extremely detailed, objective, visual terms so the description can be used " +
  "directly as an English text-to-image generation prompt to recreate this exact image as faithfully as " +
  "possible. Cover: the subject's appearance (age range, build, hair, clothing, colors, expression, pose), " +
  "the setting/background, lighting, camera framing and angle, art style (photographic, illustration, anime, " +
  "3D render, etc.), color palette, and any other notable visual details. " +
  "Output ONLY the descriptive prompt itself as flowing comma-separated descriptive phrases — no preamble, " +
  "no headings, no markdown, no explanations.";

const REFERENCE_INSTRUCTION =
  " A second reference image is also attached, showing a specific character whose identity (face, hairstyle, " +
  "and distinguishing features) must be treated as the source of truth. Describe the FIRST image's scene, pose, " +
  "clothing, setting, lighting, and art style in detail as above, but for the character's facial identity " +
  "defer to the reference image rather than the first image where they might differ.";

// Appended deterministically in code (not left to the model to remember) so
// the "don't distort the reference character" instruction is always present
// in the final prompt regardless of how well the model followed the ask —
// same reasoning as consistency.js's buildConsistencyBlock elsewhere in the
// app: a fixed instruction block is more reliable than hoping free-form
// model output includes it.
function identityNoteFor(characterName) {
  return (
    `IMPORTANT: the character shown is the reference character "${characterName}" — preserve their exact face, ` +
    "identity, hairstyle and defining features precisely as in the reference photo, do not alter or reinterpret " +
    "them; only reproduce the scene, pose, setting and style described above."
  );
}

async function analyzeImageToPrompt({ apiKey, imageBlob, referenceBlob }) {
  if (!apiKey) throw new ProviderError("Gemini: API key mancante.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(VISION_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parts = [{ text: referenceBlob ? `${BASE_INSTRUCTION}${REFERENCE_INSTRUCTION}` : BASE_INSTRUCTION }];
  parts.push({ inlineData: { mimeType: imageBlob.type || "image/png", data: await blobToBase64(imageBlob) } });
  if (referenceBlob) {
    parts.push({ inlineData: { mimeType: referenceBlob.type || "image/png", data: await blobToBase64(referenceBlob) } });
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  if (!response.ok) throw new ProviderError(`Gemini ha risposto ${response.status}: ${await readErrorText(response)}`);

  const data = await response.json();
  const textParts = (data?.candidates?.[0]?.content?.parts || []).filter((p) => p.text).map((p) => p.text);
  if (textParts.length === 0) {
    throw new ProviderError("Gemini non ha restituito una descrizione. Riprova, o verifica la API key in 'IA Esterne'.");
  }
  return textParts.join(" ").trim();
}

const previewUrls = createObjectUrlTracker();
let sourceFile = null;

function setStatus(message, type = "") {
  const box = qs("#imganalysis-status");
  if (!box) return;
  box.textContent = message;
  box.className = `status-box${type ? " " + type : ""}`;
}

function renderPreview() {
  const container = qs("#imganalysis-preview");
  if (!container) return;
  previewUrls.reset();
  container.innerHTML = "";
  if (!sourceFile) return;
  const url = previewUrls.create(sourceFile);
  container.appendChild(el("img", { src: url, alt: "Anteprima immagine da analizzare", class: "imganalysis-preview-thumb" }));
}

function renderReferenceOptions() {
  const select = qs("#imganalysis-reference-select");
  if (!select) return;
  const previous = select.value;
  select.innerHTML = "";
  select.appendChild(el("option", { value: "" }, "— seleziona un personaggio —"));
  for (const c of listCharacters()) {
    select.appendChild(el("option", { value: c.id, selected: c.id === previous ? "selected" : false }, c.name));
  }
}

// Shared by the automatic (API) path and the manual copy-paste path below,
// so both end up populating the result exactly the same way — including
// the deterministic identity note, which must apply regardless of whether
// the description came back from our own fetch() call or was typed/pasted
// in by the user from an external AI's chat.
function applyAnalysisResult(rawDescription, referenceCharacter) {
  const finalText = referenceCharacter ? `${rawDescription}, ${identityNoteFor(referenceCharacter.name)}` : rawDescription;
  qs("#imganalysis-output").value = finalText;
  qs("#imganalysis-result-card").hidden = false;
  qs("#imganalysis-use-btn").dataset.referenceCharacterId = referenceCharacter?.id || "";
}

// null whenever the toggle is off OR nothing is picked yet — callers that
// need a selection to proceed check for that themselves; this just resolves
// whatever's currently chosen without deciding whether that's valid.
async function resolveReferenceCharacter() {
  if (!qs("#imganalysis-reference-toggle").checked) return null;
  const characterId = qs("#imganalysis-reference-select").value;
  if (!characterId) return null;
  return getCharacterById(characterId);
}

async function handleAnalyze() {
  if (!sourceFile) {
    setStatus("Carica prima un'immagine da analizzare.", "error");
    return;
  }
  const settings = getProviderSettings("gemini");
  if (!settings?.apiKey) {
    setStatus("Inserisci la API key di Google Gemini nella scheda 'IA Esterne' (usata solo per analizzare, non per generare) — oppure usa l'opzione senza API qui sotto.", "error");
    return;
  }

  const referenceActive = qs("#imganalysis-reference-toggle").checked;
  if (referenceActive && !qs("#imganalysis-reference-select").value) {
    setStatus("Scegli un personaggio di riferimento, oppure disattiva l'opzione.", "error");
    return;
  }
  const referenceCharacter = await resolveReferenceCharacter();
  if (referenceActive && !referenceCharacter) {
    setStatus("Personaggio di riferimento non trovato.", "error");
    return;
  }

  const btn = qs("#imganalysis-run-btn");
  btn.disabled = true;
  setStatus("Analisi dell'immagine in corso...");

  try {
    const referenceBlob = referenceCharacter ? referenceCharacter.identityBlob || referenceCharacter.blob : null;
    const description = await analyzeImageToPrompt({ apiKey: settings.apiKey, imageBlob: sourceFile, referenceBlob });
    applyAnalysisResult(description, referenceCharacter);
    setStatus("✅ Analisi completata.", "ok");
    toast("Prompt generato dall'immagine.", "success");
  } catch (err) {
    const message = err instanceof ProviderError ? err.message : `Errore: ${err.message}`;
    setStatus(message, "error");
    toast("Errore durante l'analisi dell'immagine.", "error");
  } finally {
    btn.disabled = false;
  }
}

async function handleCopy() {
  const value = qs("#imganalysis-output").value;
  if (!value) return;
  const ok = await copyToClipboard(value);
  toast(ok ? "Prompt copiato." : "Copia non riuscita.", ok ? "success" : "error");
}

function handleUseInScene() {
  const text = qs("#imganalysis-output").value.trim();
  if (!text) return;
  const referenceCharacterId = qs("#imganalysis-use-btn").dataset.referenceCharacterId || null;
  loadPromptFromExternalText(text, { referenceCharacterId });
}

// --- Opzione senza API: copy the instructions + image(s), paste manually
// into any chat-based AI, paste its reply back here. ---

function handleOpenProvider() {
  const meta = getProviderMeta(getActiveProvider());
  if (meta?.consumerAppUrl) window.open(meta.consumerAppUrl, "_blank", "noopener");
}

async function handleCopyInstructions() {
  const referenceActive = qs("#imganalysis-reference-toggle").checked;
  const text = referenceActive ? `${BASE_INSTRUCTION}${REFERENCE_INSTRUCTION}` : BASE_INSTRUCTION;
  const ok = await copyToClipboard(text);
  toast(ok ? "Istruzioni copiate: incollale nell'IA insieme all'immagine." : "Copia non riuscita.", ok ? "success" : "error");
}

async function handleCopySourceImage() {
  if (!sourceFile) {
    toast("Carica prima un'immagine da analizzare.", "error");
    return;
  }
  const ok = await copyImageToClipboard(sourceFile);
  toast(ok ? "Immagine copiata: incollala nell'IA." : "Copia immagine non riuscita (browser non supportato).", ok ? "success" : "error");
}

async function handleCopyReferenceImageForNoApi() {
  const character = await resolveReferenceCharacter();
  if (!character) {
    toast("Attiva l'opzione e scegli un personaggio di riferimento prima.", "error");
    return;
  }
  const ok = await copyImageToClipboard(character.identityBlob || character.blob);
  toast(ok ? "Foto di riferimento copiata: incollala anche lei nell'IA." : "Copia immagine non riuscita.", ok ? "success" : "error");
}

async function handleUseManualText() {
  const text = qs("#imganalysis-noapi-paste").value.trim();
  if (!text) {
    toast("Incolla prima il testo che l'IA ti ha restituito.", "error");
    return;
  }
  const referenceActive = qs("#imganalysis-reference-toggle").checked;
  if (referenceActive && !qs("#imganalysis-reference-select").value) {
    toast("Scegli un personaggio di riferimento, oppure disattiva l'opzione.", "error");
    return;
  }
  const referenceCharacter = await resolveReferenceCharacter();
  applyAnalysisResult(text, referenceCharacter);
  setStatus("✅ Prompt caricato dal testo incollato.", "ok");
  toast("Prompt pronto.", "success");
}

function updateNoApiReferenceButtonVisibility() {
  const btn = qs("#imganalysis-noapi-copy-reference-btn");
  if (btn) btn.hidden = !qs("#imganalysis-reference-toggle").checked;
}

export function initImageAnalysis() {
  renderReferenceOptions();

  qs("#imganalysis-upload").addEventListener("change", (e) => {
    sourceFile = e.target.files?.[0] || null;
    renderPreview();
  });

  qs("#imganalysis-reference-toggle").addEventListener("change", (e) => {
    qs("#imganalysis-reference-picker-wrap").hidden = !e.target.checked;
    updateNoApiReferenceButtonVisibility();
  });

  qs("#imganalysis-run-btn").addEventListener("click", handleAnalyze);
  qs("#imganalysis-copy-btn").addEventListener("click", handleCopy);
  qs("#imganalysis-use-btn").addEventListener("click", handleUseInScene);

  qs("#imganalysis-noapi-open-btn").addEventListener("click", handleOpenProvider);
  qs("#imganalysis-noapi-copy-instructions-btn").addEventListener("click", handleCopyInstructions);
  qs("#imganalysis-noapi-copy-image-btn").addEventListener("click", handleCopySourceImage);
  qs("#imganalysis-noapi-copy-reference-btn").addEventListener("click", handleCopyReferenceImageForNoApi);
  qs("#imganalysis-noapi-use-btn").addEventListener("click", handleUseManualText);

  window.addEventListener("characters-updated", renderReferenceOptions);
}
