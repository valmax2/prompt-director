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
export function categorizeModelsForField(classType, fieldKey) {
  const { entries } = loadModelInventory();
  const expected = inferExpectedCategories(classType, fieldKey);
  if (!expected) return { green: [], yellow: entries };
  const green = [];
  const yellow = [];
  for (const entry of entries) {
    (expected.includes(entry.category) ? green : yellow).push(entry);
  }
  return { green, yellow };
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
