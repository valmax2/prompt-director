import { db } from "./db.js";
import { qs, el, uid, toast, formatBytes, formatDate, downloadBlob, sanitizeFilename, thumbWithPrivacyToggle, fileExtension, isVideoFilename, createObjectUrlTracker } from "./utils.js";

const STORE = "images";

let cache = [];
// Same leak risk as characters.js: renderGrid() rebuilds the whole grid on
// every generation, filter change, or privacy/active toggle.
const gridUrls = createObjectUrlTracker();

async function loadAll() {
  cache = await db.getAll(STORE);
  cache.sort((a, b) => b.createdAt - a.createdAt);
  return cache;
}

export async function addArchiveImage(blob, meta = {}) {
  const name = meta.name || `comic-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
  const record = {
    id: uid(),
    name,
    // Real ComfyUI filename (with its actual extension: png, gif, mp4,
    // webm...) when known, so downloads/thumbnails can tell an animation
    // apart from a still image instead of assuming everything is a .png.
    filename: meta.filename || `${name}.png`,
    blob,
    prompt: meta.prompt || "",
    workflowName: meta.workflowName || "",
    // Newly generated content defaults to hidden/blurred — the user opts
    // in per-item with the 👁️ toggle instead of everything being public
    // on the screen by default.
    private: true,
    active: true,
    createdAt: Date.now(),
  };
  await db.put(STORE, record);
  await loadAll();
  renderGrid();
  return record;
}

function matchesFilters(record) {
  const onlyActive = qs("#archive-filter-active").checked;
  const onlyPrivate = qs("#archive-filter-private").checked;
  if (onlyActive && !record.active) return false;
  if (onlyPrivate && !record.private) return false;
  return true;
}

async function toggleField(record, field) {
  record[field] = !record[field];
  await db.put(STORE, record);
  renderGrid();
}

async function removeImage(id) {
  await db.remove(STORE, id);
  await loadAll();
  renderGrid();
  toast("Immagine eliminata dall'archivio.", "info");
}

function renderGrid() {
  const root = qs("#archive-grid");
  gridUrls.reset();
  root.innerHTML = "";
  const visible = cache.filter(matchesFilters);

  if (visible.length === 0) {
    root.appendChild(el("p", { class: "hint" }, "Nessuna immagine in archivio."));
    return;
  }

  for (const record of visible) {
    const url = gridUrls.create(record.blob);
    const isVideo = isVideoFilename(record.filename);
    const card = el("div", { class: "item-card" }, [
      thumbWithPrivacyToggle(url, record.name, !!record.private, () => toggleField(record, "private"), isVideo),
      el("div", { class: "name", text: record.name + (isVideo ? " 🎬" : "") }),
      el("div", { class: "meta", text: `${formatBytes(record.blob.size)} · ${formatDate(record.createdAt)}` }),
      record.workflowName ? el("div", { class: "meta", text: `Workflow: ${record.workflowName}` }) : null,
      el("div", { class: "row" }, [
        el("label", { class: "toggle" }, [
          el("input", {
            type: "checkbox",
            checked: record.active ? "checked" : false,
            onchange: () => toggleField(record, "active"),
          }),
          "Attiva",
        ]),
      ]),
      el("div", { class: "row" }, [
        el("button", {
          class: "btn small",
          type: "button",
          onclick: () => downloadBlob(record.blob, `${sanitizeFilename(record.name)}.${fileExtension(record.filename) || "png"}`),
        }, "Scarica"),
        el("button", {
          class: "btn small danger",
          type: "button",
          onclick: () => removeImage(record.id),
        }, "Elimina"),
      ]),
    ]);
    root.appendChild(card);
  }
}

export async function initArchive() {
  await loadAll();
  renderGrid();
  qs("#archive-filter-active").addEventListener("change", renderGrid);
  qs("#archive-filter-private").addEventListener("change", renderGrid);
}

export function refreshArchive() {
  renderGrid();
}
