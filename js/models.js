import { qs, el, toast } from "./utils.js";

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
  const entries = parseModelListText(text);
  if (entries.length === 0) {
    toast(
      "Nessun modello riconosciuto in quel file (servono righe che finiscono con .safetensors, .ckpt, .pt, .pth, .bin, .onnx o .gguf).",
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
}
