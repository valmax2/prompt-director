import { qs, el, toast, copyToClipboard, createObjectUrlTracker } from "./utils.js";
import { getProviderSettings } from "./state.js";
import { listCharacters, getCharacterById } from "./characters.js";
import { blobToBase64, readErrorText, ProviderError } from "./providers.js";
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

async function handleAnalyze() {
  if (!sourceFile) {
    setStatus("Carica prima un'immagine da analizzare.", "error");
    return;
  }
  const settings = getProviderSettings("gemini");
  if (!settings?.apiKey) {
    setStatus("Inserisci la API key di Google Gemini nella scheda 'IA Esterne' (usata solo per analizzare, non per generare).", "error");
    return;
  }

  const referenceActive = qs("#imganalysis-reference-toggle").checked;
  let referenceCharacter = null;
  if (referenceActive) {
    const characterId = qs("#imganalysis-reference-select").value;
    if (!characterId) {
      setStatus("Scegli un personaggio di riferimento, oppure disattiva l'opzione.", "error");
      return;
    }
    referenceCharacter = await getCharacterById(characterId);
    if (!referenceCharacter) {
      setStatus("Personaggio di riferimento non trovato.", "error");
      return;
    }
  }

  const btn = qs("#imganalysis-run-btn");
  btn.disabled = true;
  setStatus("Analisi dell'immagine in corso...");

  try {
    const referenceBlob = referenceCharacter ? referenceCharacter.identityBlob || referenceCharacter.blob : null;
    let description = await analyzeImageToPrompt({ apiKey: settings.apiKey, imageBlob: sourceFile, referenceBlob });
    if (referenceCharacter) description = `${description}, ${identityNoteFor(referenceCharacter.name)}`;

    qs("#imganalysis-output").value = description;
    qs("#imganalysis-result-card").hidden = false;
    qs("#imganalysis-use-btn").dataset.referenceCharacterId = referenceCharacter?.id || "";
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

export function initImageAnalysis() {
  renderReferenceOptions();

  qs("#imganalysis-upload").addEventListener("change", (e) => {
    sourceFile = e.target.files?.[0] || null;
    renderPreview();
  });

  qs("#imganalysis-reference-toggle").addEventListener("change", (e) => {
    qs("#imganalysis-reference-picker-wrap").hidden = !e.target.checked;
  });

  qs("#imganalysis-run-btn").addEventListener("click", handleAnalyze);
  qs("#imganalysis-copy-btn").addEventListener("click", handleCopy);
  qs("#imganalysis-use-btn").addEventListener("click", handleUseInScene);

  window.addEventListener("characters-updated", renderReferenceOptions);
}
