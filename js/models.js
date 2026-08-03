import { qs, el, toast, downloadBlob } from "./utils.js";

const STORAGE_KEY = "comic-studio:model-inventory";
const MODEL_FILE_EXTENSIONS = /\.(safetensors|ckpt|pt|pth|bin|onnx|gguf)$/i;

// A node/field counts as a "model reference" if its current value is a bare
// filename ending in a known model extension — this works for ANY loader
// node (built-in or custom) without hardcoding class_type names, the same
// way the rest of the mapping system stays generic to whatever's actually
// in the imported graph instead of a fixed list of known node types.
export function isModelFilename(value) {
  return typeof value === "string" && MODEL_FILE_EXTENSIONS.test(value);
}

// A checkpoint, VAE, text encoder, LoRA and ControlNet all have to belong to
// the SAME base-model family (SDXL, Flux, SD1.5, Qwen-Image, LTX-Video...)
// to actually work together — ComfyUI itself never checks this (a file just
// has to exist in the right folder), so mixing families silently produces
// either a crash deeper in the pipeline or a broken image, not the
// "value not in list" error the folder/format checks above catch. Guessed
// from the filename only — best-effort, not a guarantee, but catches the
// common case (model names are almost always self-descriptive) without
// needing to read file contents or call out to the internet.
// No \b word-boundary around the family token itself: real filenames butt
// version numbers straight up against it with no separator ("flux1-dev",
// "sdxl_lightning"), which \b would refuse to match since digits/letters
// are both "word" characters with no boundary between them.
const FAMILY_HINTS = [
  { pattern: /flux/i, family: "Flux" },
  { pattern: /sd[-_]?3\.?5/i, family: "SD3.5" },
  { pattern: /sd[-_]?xl|sdxl/i, family: "SDXL" },
  { pattern: /sd[-_]?3(?!\.?5)/i, family: "SD3" },
  { pattern: /pony/i, family: "Pony (SDXL)" },
  { pattern: /qwen/i, family: "Qwen-Image" },
  { pattern: /hunyuan/i, family: "HunyuanVideo" },
  { pattern: /ltx/i, family: "LTX-Video" },
  { pattern: /\bwan\d/i, family: "Wan" },
  { pattern: /sd[-_]?2\.?1/i, family: "SD2.1" },
  { pattern: /sd[-_]?1\.?5|v1-5/i, family: "SD1.5" },
];

export function guessModelFamily(filename) {
  for (const hint of FAMILY_HINTS) {
    if (hint.pattern.test(filename || "")) return hint.family;
  }
  return null; // no recognizable family in the name — never flagged as a mismatch
}

// Which inventory categories a node/field is expected to draw from, guessed
// from the node's class_type first (most reliable) and the field name
// second — e.g. a "LoraLoader" class or a field literally called
// "lora_name" both point at the "loras" folder. Returns null when nothing
// matches, meaning "unknown" rather than a false-confident guess.
const CATEGORY_HINTS = [
  { pattern: /checkpoint|ckpt/i, categories: ["checkpoints", "checkpoint"] },
  { pattern: /lora/i, categories: ["loras", "lora"] },
  { pattern: /vae/i, categories: ["vae"] },
  { pattern: /controlnet|control_net/i, categories: ["controlnet"] },
  { pattern: /clip_?vision/i, categories: ["clip_vision"] },
  { pattern: /clip/i, categories: ["clip", "text_encoders"] },
  { pattern: /unet|diffusion_?model/i, categories: ["unet", "diffusion_models"] },
  { pattern: /upscale/i, categories: ["upscale_models"] },
  { pattern: /embedding/i, categories: ["embeddings"] },
  { pattern: /hypernetwork/i, categories: ["hypernetworks"] },
  { pattern: /style_?model/i, categories: ["style_models"] },
];

export function inferExpectedCategories(classType, fieldKey) {
  for (const hint of CATEGORY_HINTS) {
    if (hint.pattern.test(classType || "") || hint.pattern.test(fieldKey || "")) return hint.categories;
  }
  return null;
}

function normalizeCategory(raw) {
  return (raw || "").trim().toLowerCase();
}

// One entry per non-empty line of the uploaded text file: the first path
// segment is treated as the category (matching ComfyUI's own models/<type>/
// folder layout), the rest of the path is what gets written into the node's
// input field (ComfyUI accepts "subfolder/file.safetensors" style values).
export function parseModelListText(text) {
  const lines = (text || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, "/").replace(/^\.?\//, ""))
    .filter(Boolean);
  const entries = [];
  const seen = new Set();
  for (const line of lines) {
    const segments = line.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    const filename = segments[segments.length - 1];
    if (!isModelFilename(filename)) continue; // skip non-model files (readme, config, etc.)
    const category = normalizeCategory(segments.length > 1 ? segments[0] : "");
    const path = segments.length > 1 ? segments.slice(1).join("/") : filename;
    const key = `${category}:${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ category, path, filename });
  }
  return entries;
}

// Structured counterpart to parseModelListText(): produced by
// buildInventoryJson()/scanModelsFolder() below, and re-loadable later so a
// scan done once can be re-uploaded on another device without redoing it.
export function buildInventoryJson(entries) {
  return JSON.stringify(
    {
      version: 1,
      generatedAt: new Date().toISOString(),
      models: entries.map((e) => ({ category: e.category, path: e.path })),
    },
    null,
    2
  );
}

export function parseModelInventoryJson(text) {
  const data = JSON.parse(text);
  const models = Array.isArray(data?.models) ? data.models : [];
  const entries = [];
  const seen = new Set();
  for (const m of models) {
    const path = String(m?.path || "").replace(/\\/g, "/").trim();
    const segments = path.split("/").filter(Boolean);
    const filename = segments[segments.length - 1];
    if (!filename || !isModelFilename(filename)) continue;
    const category = normalizeCategory(m?.category || "");
    const key = `${category}:${path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ category, path, filename });
  }
  return entries;
}

// File System Access API (Chromium desktop only — no Firefox/Safari, no
// mobile browsers) lets the app read a picked folder's file/directory names
// directly, without any upload — so the model list can be regenerated with
// one click instead of running a terminal command by hand every time.
export function isDirectoryScanSupported() {
  return typeof window !== "undefined" && !!window.showDirectoryPicker;
}

async function walkDirectoryForModels(dirHandle, category, pathPrefix, entries, seen) {
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === "directory") {
      await walkDirectoryForModels(handle, category, `${pathPrefix}${name}/`, entries, seen);
    } else if (isModelFilename(name)) {
      const path = `${pathPrefix}${name}`;
      const key = `${category}:${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ category, path, filename: name });
    }
  }
}

// The picked folder is expected to be ComfyUI's "models" folder itself —
// its immediate subfolders (checkpoints/loras/vae/...) become the
// categories, exactly like a manually-typed list's first path segment.
export async function scanModelsFolder() {
  if (!isDirectoryScanSupported()) {
    throw new Error("La scansione automatica richiede un browser desktop basato su Chrome/Edge — non è disponibile su questo browser o dispositivo.");
  }
  const rootHandle = await window.showDirectoryPicker({ id: "comfyui-models", mode: "read" });
  const entries = [];
  const seen = new Set();
  for await (const [name, handle] of rootHandle.entries()) {
    if (handle.kind === "directory") {
      await walkDirectoryForModels(handle, normalizeCategory(name), "", entries, seen);
    } else if (isModelFilename(name)) {
      const key = `:${name}`;
      if (!seen.has(key)) {
        seen.add(key);
        entries.push({ category: "", path: name, filename: name });
      }
    }
  }
  return entries;
}

export function loadModelInventory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { entries: [], updatedAt: null, sourceName: "" };
  } catch {
    return { entries: [], updatedAt: null, sourceName: "" };
  }
}

export function saveModelInventory(entries, sourceName = "") {
  const inventory = { entries, updatedAt: Date.now(), sourceName };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(inventory));
  return inventory;
}

export function clearModelInventory() {
  localStorage.removeItem(STORAGE_KEY);
}

// { green, yellow } — green = category matches what this node/field is
// expected to draw from, yellow = everything else (untested — ComfyUI
// itself doesn't enforce that a node's input value lives in any particular
// models/ subfolder, so a yellow pick can still work, just isn't confirmed).
// Pulls the exact list of valid values ComfyUI's own /object_info reports
// for a combo/dropdown input — the authoritative source when ComfyUI is
// reachable, since it's exactly what that server will accept right now
// (correct folder AND format AND actually present on disk), sidestepping
// every way the local-inventory heuristic below can be wrong. Returns null
// when the field isn't a combo input (e.g. a plain STRING/INT type) or the
// node/field isn't present in the response at all.
export function extractComboOptions(objectInfo, classType, fieldKey) {
  const nodeInfo = objectInfo?.[classType];
  const fieldDef = nodeInfo?.input?.required?.[fieldKey] || nodeInfo?.input?.optional?.[fieldKey];
  const optionsSpec = fieldDef?.[0];
  return Array.isArray(optionsSpec) ? optionsSpec : null;
}

// GGUF is a different (quantized/compressed) file format, not just another
// folder — the plain built-in loaders (UNETLoader, CheckpointLoaderSimple,
// LoraLoader, VAELoader...) genuinely cannot read it, only a class_type
// containing "GGUF" (from the ComfyUI-GGUF custom node pack, e.g.
// "UnetLoaderGGUF") can. A same-folder match alone used to mark these as
// ✅ compatible, which was wrong: ComfyUI rejects them outright with
// "value not in list" regardless of the folder being correct. Excluded
// entirely here rather than downgraded to 🟡, since "untested, might work"
// would still be misleading for something that's guaranteed to fail.
const GGUF_EXTENSION = /\.gguf$/i;

function nodeSupportsGguf(classType) {
  return /gguf/i.test(classType || "");
}

export function categorizeModelsForField(classType, fieldKey) {
  const { entries } = loadModelInventory();
  const expected = inferExpectedCategories(classType, fieldKey);
  const supportsGguf = nodeSupportsGguf(classType);
  const green = [];
  const yellow = [];
  let hiddenGguf = 0;
  for (const entry of entries) {
    if (GGUF_EXTENSION.test(entry.filename) && !supportsGguf) {
      hiddenGguf++;
      continue;
    }
    if (expected && expected.includes(entry.category)) green.push(entry);
    else yellow.push(entry);
  }
  return { green, yellow, hiddenGguf };
}

function summaryText(inventory) {
  if (!inventory.entries.length) return "Nessun modello caricato.";
  const categories = new Set(inventory.entries.map((e) => e.category || "(senza categoria)"));
  return `${inventory.entries.length} modelli in ${categories.size} categorie${inventory.sourceName ? ` · da "${inventory.sourceName}"` : ""}.`;
}

function renderSummary() {
  const box = qs("#model-inventory-summary");
  if (!box) return;
  box.textContent = summaryText(loadModelInventory());
}

async function handleModelListUpload(file) {
  const text = await file.text();
  const isJson = file.name.toLowerCase().endsWith(".json");
  let entries;
  try {
    entries = isJson ? parseModelInventoryJson(text) : parseModelListText(text);
  } catch (err) {
    toast(`Errore nel file "${file.name}": ${err.message}`, "error", 6000);
    return;
  }
  if (entries.length === 0) {
    toast(
      "Nessun modello riconosciuto in quel file (servono righe/percorsi che finiscono con .safetensors, .ckpt, .pt, .pth, .bin, .onnx o .gguf).",
      "error",
      6000
    );
    return;
  }
  saveModelInventory(entries, file.name);
  renderSummary();
  toast(`${entries.length} modelli caricati.`, "success");
  window.dispatchEvent(new CustomEvent("model-inventory-updated"));
}

async function handleScanFolder() {
  try {
    const entries = await scanModelsFolder();
    if (entries.length === 0) {
      toast("Nessun file modello trovato in quella cartella.", "error");
      return;
    }
    const json = buildInventoryJson(entries);
    await downloadBlob(new Blob([json], { type: "application/json" }), "comfy_inventory_v1.json");
    saveModelInventory(entries, "comfy_inventory_v1.json");
    renderSummary();
    toast(`${entries.length} modelli trovati e caricati (comfy_inventory_v1.json salvato).`, "success");
    window.dispatchEvent(new CustomEvent("model-inventory-updated"));
  } catch (err) {
    if (err?.name === "AbortError") return; // user closed the folder picker — nothing to do
    toast(`Errore durante la scansione: ${err.message}`, "error", 6000);
  }
}

export function initModelInventory() {
  renderSummary();
  qs("#model-inventory-upload").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) handleModelListUpload(file);
    e.target.value = "";
  });
  qs("#model-inventory-clear-btn").addEventListener("click", () => {
    clearModelInventory();
    renderSummary();
    toast("Elenco modelli svuotato.", "info");
    window.dispatchEvent(new CustomEvent("model-inventory-updated"));
  });

  const scanBtn = qs("#model-inventory-scan-btn");
  if (isDirectoryScanSupported()) {
    scanBtn.addEventListener("click", handleScanFolder);
  } else {
    scanBtn.disabled = true;
    scanBtn.title = "Richiede un browser desktop basato su Chrome/Edge (non disponibile qui).";
  }
}
