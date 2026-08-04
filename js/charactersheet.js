import { qs, qsa, el, uid, toast, thumbWithPrivacyToggle, createObjectUrlTracker, copyToClipboard, copyImageToClipboard } from "./utils.js";
import { listCharacters, getCharacterById } from "./characters.js";
import { getActiveWorkflow } from "./workflows.js";
import { getConnectionSettings, getGenerationMode, getActiveProvider, getProviderSettings, onStateChange } from "./state.js";
import { ComfyUIClient, ComfyUIError } from "./comfyui.js";
import { addArchiveImage, refreshArchive } from "./archive.js";
import { optimizePrompt, tagify, DEFAULT_NEGATIVE_EN } from "./translate.js";
import { generateImageExternal, getProviderMeta, ProviderError } from "./providers.js";

const sessionClientId = uid();
const resultUrls = createObjectUrlTracker();

// Shared across every view so the six images read as one consistent
// character/model sheet (plain background, same lighting) rather than six
// unrelated pictures that happen to share a face.
const SHEET_BASE_TAGS = [
  "character reference sheet",
  "character turnaround",
  "consistent character design",
  "same character, same face, same outfit in every image",
  "plain neutral gray studio background",
  "even studio lighting, no harsh shadows",
];

const QUALITY_TAGS = [
  "ultra detailed",
  "extremely detailed",
  "high resolution",
  "8k",
  "sharp focus",
  "masterpiece quality",
  "professional character design sheet",
];

const VIEWS = [
  { key: "front", label: "Fronte", tag: "front view, facing directly at camera, neutral expression" },
  { key: "threeQuarterRight", label: "3/4 destra", tag: "three-quarter view turned to the right, looking slightly away from camera" },
  { key: "profileLeft", label: "Profilo sinistro", tag: "full left side profile view, 90 degree profile, facing left" },
  { key: "threeQuarterLeft", label: "3/4 sinistra", tag: "three-quarter view turned to the left, looking slightly away from camera" },
  { key: "profileRight", label: "Profilo destro", tag: "full right side profile view, 90 degree profile, facing right" },
  { key: "frontSmiling", label: "Fronte sorridente", tag: "front view, facing directly at camera, warm smiling expression" },
];

const MODES = {
  face: {
    label: "Solo viso",
    framingTag: "close-up portrait, head and shoulders framing, face focus",
    width: 1024,
    height: 1024,
  },
  fullbody: {
    label: "Full body",
    framingTag: "full body shot, head to toe fully visible, standing pose, arms relaxed at sides",
    width: 896,
    height: 1152,
  },
};

let selectedCharacterId = "";
let selectedMode = "face";
let generating = false;
let lastResults = [];

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function buildPositivePrompt(character, view, mode) {
  return optimizePrompt(character.name || "", {
    extraTags: [view.tag, mode.framingTag, ...SHEET_BASE_TAGS, ...QUALITY_TAGS],
  });
}

function buildNegativePrompt() {
  return tagify(DEFAULT_NEGATIVE_EN, [
    "cluttered background",
    "multiple characters",
    "different outfit",
    "different face",
    "different hairstyle",
    "collage",
    "grid lines",
    "text labels",
    "watermark",
  ]);
}

async function generateOneViewLocal(client, workflow, character, view, mode) {
  const graph = deepClone(workflow.json);
  const mapping = workflow.mapping || {};
  const positive = buildPositivePrompt(character, view, mode);
  const negative = buildNegativePrompt();

  const positiveMappings = Array.isArray(mapping.positives) ? mapping.positives : mapping.positive ? [mapping.positive] : [];
  for (const m of positiveMappings) graph[m.nodeId].inputs[m.field] = positive;
  const negativeMappings = Array.isArray(mapping.negatives) ? mapping.negatives : mapping.negative ? [mapping.negative] : [];
  for (const m of negativeMappings) graph[m.nodeId].inputs[m.field] = negative;

  if (mapping.seed) {
    graph[mapping.seed.nodeId].inputs[mapping.seed.field] = Math.floor(Math.random() * 1e15);
  }
  if (mapping.resolution) {
    graph[mapping.resolution.nodeId].inputs[mapping.resolution.widthField] = mode.width;
    graph[mapping.resolution.nodeId].inputs[mapping.resolution.heightField] = mode.height;
  }

  // A character sheet is always exactly one character: every "character"/
  // "identity" image slot the workflow defines gets filled with that same
  // person's reference photo (prefer the close-up identity photo when the
  // slot asks for one and it exists); "pose" slots are left untouched since
  // a fixed turnaround pose is exactly what these prompts already dictate.
  const imageMappings = Array.isArray(mapping.images) ? mapping.images : mapping.image ? [mapping.image] : [];
  const uploadedByKey = new Map();
  for (const imageMapping of imageMappings) {
    const source = imageMapping.source || "character";
    if (source === "pose") continue;
    const useIdentityBlob = source === "identity" && !!character.identityBlob;
    const blob = useIdentityBlob ? character.identityBlob : character.blob;
    const uploadKey = useIdentityBlob ? "identity" : "character";
    let uploaded = uploadedByKey.get(uploadKey);
    if (!uploaded) {
      const safeId = character.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
      const safeName = useIdentityBlob ? `identity-${safeId}.png` : `char-${safeId}.png`;
      const result = await client.uploadImage(blob, safeName);
      uploaded = result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
      uploadedByKey.set(uploadKey, uploaded);
    }
    graph[imageMapping.nodeId].inputs[imageMapping.field] = uploaded;
  }

  const queued = await client.queuePrompt(graph, sessionClientId);
  if (queued.node_errors && Object.keys(queued.node_errors).length > 0) {
    throw new ComfyUIError(`Errori nei nodi del workflow: ${JSON.stringify(queued.node_errors)}`);
  }
  const images = await client.waitForResult(queued.prompt_id, sessionClientId, { timeoutMs: 20 * 60 * 1000 });
  if (images.length === 0) {
    throw new ComfyUIError("Generazione completata ma nessuna immagine restituita.");
  }
  return client.fetchImageBlob(images[0]);
}

// External providers only take a single flat prompt + one optional reference
// image (no node graph, no seed/resolution mapping) — much simpler than the
// local path, but reference-image support varies by provider (Leonardo.ai
// has none), so identity consistency across the 6 views is weaker there.
async function generateOneViewExternal(providerId, providerSettings, providerMeta, character, view, mode) {
  const positive = buildPositivePrompt(character, view, mode);
  const negative = buildNegativePrompt();
  const referenceBlob = providerMeta?.supportsReferenceImage ? character.identityBlob || character.blob : null;
  const blobs = await generateImageExternal({ provider: providerId, settings: providerSettings, positive, negative, referenceBlob });
  if (blobs.length === 0) throw new ProviderError("Nessuna immagine restituita dal provider.");
  return blobs[0];
}

function setStatus(message, type = "") {
  const box = qs("#charsheet-status");
  if (!box) return;
  box.textContent = message;
  box.className = `status-box${type ? " " + type : ""}`;
}

function renderCharacterOptions() {
  const select = qs("#charsheet-character-select");
  if (!select) return;
  const characters = listCharacters();
  select.innerHTML = "";
  select.appendChild(el("option", { value: "" }, "— seleziona un personaggio —"));
  for (const c of characters) {
    select.appendChild(el("option", { value: c.id, selected: c.id === selectedCharacterId ? "selected" : false }, c.name));
  }
  if (!characters.some((c) => c.id === selectedCharacterId)) selectedCharacterId = "";
  select.value = selectedCharacterId;
}

async function handleCopyViewPrompt(character, view, mode) {
  const positive = buildPositivePrompt(character, view, mode);
  const negative = buildNegativePrompt();
  const combined = `${positive}\n\nDa evitare: ${negative}`;
  const ok = await copyToClipboard(combined);
  toast(ok ? `Prompt "${view.label}" copiato.` : "Copia non riuscita.", ok ? "success" : "error");
}

async function handleCopyCharacterImage() {
  if (!selectedCharacterId) {
    toast("Seleziona prima un personaggio.", "error");
    return;
  }
  const character = await getCharacterById(selectedCharacterId);
  if (!character) {
    toast("Personaggio non trovato.", "error");
    return;
  }
  const blob = character.identityBlob || character.blob;
  const ok = await copyImageToClipboard(blob);
  toast(ok ? "Immagine copiata: incollala nell'IA." : "Copia immagine non riuscita (browser non supportato).", ok ? "success" : "error");
}

function handleOpenProvider() {
  const meta = getProviderMeta(getActiveProvider());
  if (meta?.consumerAppUrl) window.open(meta.consumerAppUrl, "_blank", "noopener");
}

async function renderNoApiSection() {
  const openBtn = qs("#charsheet-noapi-open-btn");
  const list = qs("#charsheet-noapi-list");
  if (!openBtn || !list) return;

  const meta = getProviderMeta(getActiveProvider());
  openBtn.textContent = `🔗 Apri ${meta?.label || "IA"}`;

  list.innerHTML = "";
  if (!selectedCharacterId) {
    list.appendChild(el("p", { class: "hint" }, "Seleziona un personaggio per vedere i 6 prompt da copiare."));
    return;
  }
  const character = await getCharacterById(selectedCharacterId);
  if (!character) return;
  const mode = MODES[selectedMode];

  for (const view of VIEWS) {
    const row = el("div", { class: "item-card" }, [
      el("div", { class: "name", text: view.label }),
      el(
        "button",
        { type: "button", class: "btn small", onclick: () => handleCopyViewPrompt(character, view, mode) },
        "📋 Copia prompt"
      ),
    ]);
    list.appendChild(row);
  }
}

function renderResults() {
  const grid = qs("#charsheet-grid");
  if (!grid) return;
  resultUrls.reset();
  grid.innerHTML = "";
  if (lastResults.length === 0) {
    grid.appendChild(el("p", { class: "hint" }, "Nessuna immagine generata ancora."));
    return;
  }
  for (const result of lastResults) {
    const url = resultUrls.create(result.blob);
    const card = el("div", { class: "item-card" }, [
      thumbWithPrivacyToggle(url, result.view.label, result.hidden, () => {
        result.hidden = !result.hidden;
        renderResults();
      }),
      el("div", { class: "name", text: result.view.label }),
    ]);
    grid.appendChild(card);
  }
}

// Builds the per-view generator function for whichever mode (ComfyUI locale
// / IA Esterna) is currently selected in the header toggle — same switch
// prompts.js's handleSend() uses. Returns null (after setting a status
// message) when that mode isn't ready to generate yet.
async function prepareRunner(character) {
  if (getGenerationMode() === "external") {
    const providerId = getActiveProvider();
    const providerMeta = getProviderMeta(providerId);
    const providerSettings = getProviderSettings(providerId);
    if (!providerSettings?.apiKey) {
      setStatus(`Inserisci la API key di ${providerMeta?.label || providerId} nella scheda 'IA Esterne'.`, "error");
      return null;
    }
    if (!providerMeta?.supportsReferenceImage) {
      setStatus(`${providerMeta?.label || providerId} non supporta l'immagine di riferimento: la coerenza col volto sarà minore.`, "");
    }
    return {
      workflowName: `IA esterna: ${providerMeta?.label || providerId}`,
      run: (view, mode) => generateOneViewExternal(providerId, providerSettings, providerMeta, character, view, mode),
    };
  }

  const settings = getConnectionSettings();
  if (!settings) {
    setStatus("Configura prima la connessione a ComfyUI nella scheda 'Connessione ComfyUI'.", "error");
    return null;
  }
  const workflow = await getActiveWorkflow();
  if (!workflow) {
    setStatus("Seleziona un workflow attivo nella scheda 'Workflow'.", "error");
    return null;
  }
  const client = new ComfyUIClient(settings);
  return {
    workflowName: workflow.name,
    run: (view, mode) => generateOneViewLocal(client, workflow, character, view, mode),
  };
}

async function handleGenerateSheet() {
  if (generating) return;
  if (!selectedCharacterId) {
    setStatus("Seleziona prima un personaggio.", "error");
    return;
  }
  const character = await getCharacterById(selectedCharacterId);
  if (!character) {
    setStatus("Personaggio non trovato.", "error");
    return;
  }

  const runner = await prepareRunner(character);
  if (!runner) return;

  const mode = MODES[selectedMode];
  generating = true;
  qs("#charsheet-generate-btn").disabled = true;
  lastResults = [];
  renderResults();

  try {
    for (let i = 0; i < VIEWS.length; i++) {
      const view = VIEWS[i];
      setStatus(`Generazione ${i + 1}/${VIEWS.length}: ${view.label}...`);
      const blob = await runner.run(view, mode);
      lastResults.push({ view, blob, hidden: true });
      renderResults();
      await addArchiveImage(blob, {
        name: `${character.name}-scheda-${view.key}`,
        prompt: buildPositivePrompt(character, view, mode),
        workflowName: runner.workflowName,
      });
    }
    refreshArchive();
    setStatus(`✅ Scheda completata: ${lastResults.length}/${VIEWS.length} immagini generate e salvate in Archivio (private di default).`, "ok");
    toast("Scheda personaggio completata.", "success");
  } catch (err) {
    const message = err instanceof ComfyUIError || err instanceof ProviderError ? err.message : `Errore: ${err.message}`;
    setStatus(`${message} (generate ${lastResults.length}/${VIEWS.length} prima dell'errore)`, "error");
    toast("Errore nella generazione della scheda personaggio.", "error");
  } finally {
    generating = false;
    qs("#charsheet-generate-btn").disabled = false;
  }
}

export function initCharacterSheet() {
  renderCharacterOptions();
  renderResults();
  renderNoApiSection();

  qs("#charsheet-character-select").addEventListener("change", (e) => {
    selectedCharacterId = e.target.value;
    renderNoApiSection();
  });
  qsa("input[name=charsheet-mode]").forEach((radio) => {
    radio.addEventListener("change", (e) => {
      if (e.target.checked) selectedMode = e.target.value;
      renderNoApiSection();
    });
  });
  qs("#charsheet-generate-btn").addEventListener("click", handleGenerateSheet);
  qs("#charsheet-noapi-open-btn").addEventListener("click", handleOpenProvider);
  qs("#charsheet-noapi-copyimg-btn").addEventListener("click", handleCopyCharacterImage);
  window.addEventListener("characters-updated", () => {
    renderCharacterOptions();
    renderNoApiSection();
  });
  window.addEventListener("generation-mode-ui-updated", renderNoApiSection);
  onStateChange((event) => {
    if (event === "active-provider-updated" || event === "provider-settings-updated") renderNoApiSection();
  });
}
