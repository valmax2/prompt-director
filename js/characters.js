import { db } from "./db.js";
import { qs, el, uid, toast, formatBytes, formatDate, sanitizeFilename, thumbWithPrivacyToggle, copyImageToClipboard, downloadBlob, createObjectUrlTracker } from "./utils.js";

const STORE = "characters";
const MAX_SIZE = 15 * 1024 * 1024; // 15MB per image, generous but bounded

let cache = [];
// renderGrid() fully rebuilds the grid on every small change (toggle, rename,
// add, remove) — without this, each rebuild would leak the previous
// render's object URLs since nothing else ever revokes them.
const gridUrls = createObjectUrlTracker();

function notifyUpdated() {
  window.dispatchEvent(new CustomEvent("characters-updated", { detail: cache }));
}

async function loadAll() {
  cache = await db.getAll(STORE);
  cache.sort((a, b) => b.createdAt - a.createdAt);
  return cache;
}

export function listCharacters() {
  return cache;
}

export async function getCharacterById(id) {
  return cache.find((c) => c.id === id) || db.get(STORE, id);
}

// `character.blob` is the existing full-body/costume reference (unchanged,
// so nothing that already worked stops working). `identityBlob` is a NEW,
// optional close-up-of-the-face photo used by the Character Consistency
// system to keep facial identity stable independently from body/costume.
async function setCharacterIdentityBlob(character, blob) {
  character.identityBlob = blob;
  await db.put(STORE, character);
  await loadAll();
  renderGrid();
  notifyUpdated();
}

async function removeCharacterIdentityBlob(character) {
  delete character.identityBlob;
  await db.put(STORE, character);
  await loadAll();
  renderGrid();
  notifyUpdated();
}

// Shared by the character grid's own eye-toggle and the small preview shown
// next to the character picker in "Crea Scena", so revealing/hiding a
// character reads the same everywhere instead of each place keeping its own
// copy of the visibility flag.
export async function setCharacterVisibility(id, visible) {
  const character = cache.find((c) => c.id === id);
  if (!character) return;
  character.visible = visible;
  await db.put(STORE, character);
  await loadAll();
  renderGrid();
  notifyUpdated();
}

function renderGrid() {
  const root = qs("#character-grid");
  gridUrls.reset();
  root.innerHTML = "";

  if (cache.length === 0) {
    root.appendChild(el("p", { class: "hint" }, "Nessun personaggio caricato."));
    return;
  }

  for (const character of cache) {
    const url = gridUrls.create(character.blob);
    const nameDisplay = el("div", { class: "name", text: character.name });
    const isHidden = character.visible === false;

    const card = el("div", { class: "item-card" }, [
      thumbWithPrivacyToggle(url, character.name, isHidden, () => setCharacterVisibility(character.id, isHidden)),
      nameDisplay,
      el("div", { class: "meta", text: `${formatBytes(character.blob.size)} · ${formatDate(character.createdAt)}` }),
      el("div", { class: "row" }, [
        el("button", {
          class: "btn small",
          type: "button",
          title: "Copia la foto negli appunti, per incollarla in un'altra app (es. ChatGPT)",
          onclick: async () => {
            const ok = await copyImageToClipboard(character.blob);
            toast(
              ok ? "Immagine copiata: ora puoi incollarla (es. in ChatGPT)." : "Copia non supportata su questo browser: usa Scarica.",
              ok ? "success" : "error"
            );
          },
        }, "📋 Copia immagine"),
        el("button", {
          class: "btn small",
          type: "button",
          onclick: () => downloadBlob(character.blob, `${sanitizeFilename(character.name)}.png`),
        }, "⬇️ Scarica"),
      ]),
      el("div", { class: "row" }, [
        el("button", {
          class: "btn small",
          type: "button",
          onclick: () => startRename(character, nameDisplay),
        }, "Rinomina"),
        el("button", {
          class: "btn small danger",
          type: "button",
          onclick: () => removeCharacter(character.id),
        }, "Elimina"),
      ]),
      renderIdentityRow(character),
    ]);
    root.appendChild(card);
  }
}

// Optional secondary "identity" (face close-up) reference, kept independent
// from the main character.blob (body/costume) — used by Personaggio Coerente
// to feed a dedicated identity node without touching the body/costume node.
function renderIdentityRow(character) {
  if (character.identityBlob) {
    const url = gridUrls.create(character.identityBlob);
    return el("div", { class: "row identity-row" }, [
      el("img", { src: url, alt: "Volto", class: "identity-thumb" }),
      el("span", { class: "hint small" }, "Foto identità (volto)"),
      el("button", {
        class: "btn small danger",
        type: "button",
        onclick: () => removeCharacterIdentityBlob(character),
      }, "Rimuovi volto"),
    ]);
  }
  return el("div", { class: "row identity-row" }, [
    el("label", { class: "btn small" }, [
      "➕ Foto volto (identità, opzionale)",
      el("input", {
        type: "file",
        accept: "image/*",
        hidden: true,
        onchange: (e) => {
          const file = e.target.files?.[0];
          if (file) setCharacterIdentityBlob(character, file);
          e.target.value = "";
        },
      }),
    ]),
  ]);
}

function startRename(character, nameDisplay) {
  const input = el("input", { type: "text", value: character.name });
  nameDisplay.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const newName = sanitizeFilename(input.value || character.name);
    character.name = newName;
    await db.put(STORE, character);
    await loadAll();
    renderGrid();
    notifyUpdated();
  };

  input.addEventListener("blur", commit, { once: true });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") { input.value = character.name; input.blur(); }
  });
}

async function removeCharacter(id) {
  await db.remove(STORE, id);
  await loadAll();
  renderGrid();
  notifyUpdated();
  toast("Personaggio eliminato.", "info");
}

export async function addCharacterFromBlob(blob, name, visible = true) {
  const record = {
    id: uid(),
    name: sanitizeFilename(name),
    blob,
    visible,
    createdAt: Date.now(),
  };
  await db.put(STORE, record);
  await loadAll();
  renderGrid();
  notifyUpdated();
  return record;
}

// Selected files don't get saved straight away — they land in a small
// preview list first, each with its own privacy checkbox (private by
// default, consistent with generated content), so the user sees what
// they're adding and decides visibility before it's committed.
let pendingUploads = [];

function clearPendingUploads() {
  for (const entry of pendingUploads) URL.revokeObjectURL(entry.url);
  pendingUploads = [];
  qs("#character-pending-preview").hidden = true;
  qs("#character-pending-list").innerHTML = "";
}

function renderPendingUploads() {
  const panel = qs("#character-pending-preview");
  const list = qs("#character-pending-list");
  list.innerHTML = "";

  if (pendingUploads.length === 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  pendingUploads.forEach((entry, index) => {
    const nameInput = el("input", {
      type: "text",
      value: entry.name,
      oninput: () => { entry.name = nameInput.value; },
    });
    const privacyToggle = el("label", { class: "toggle" }, [
      el("input", {
        type: "checkbox",
        checked: entry.private ? "checked" : false,
        onchange: () => { entry.private = privacyCheckbox.checked; },
      }),
      "Privata",
    ]);
    const privacyCheckbox = privacyToggle.querySelector("input");
    const thumbImg = el("img", { src: entry.url, alt: entry.name, class: entry.private ? "blurred" : "" });
    privacyCheckbox.addEventListener("change", () => {
      thumbImg.className = entry.private ? "blurred" : "";
    });
    list.appendChild(
      el("div", { class: "item-card" }, [
        el("div", { class: "thumb-wrap" }, [thumbImg]),
        nameInput,
        privacyToggle,
        el("button", {
          class: "btn small danger",
          type: "button",
          onclick: () => {
            URL.revokeObjectURL(entry.url);
            pendingUploads.splice(index, 1);
            renderPendingUploads();
          },
        }, "Rimuovi"),
      ])
    );
  });
}

async function handleUpload(fileList) {
  for (const file of Array.from(fileList)) {
    if (!file.type.startsWith("image/")) {
      toast(`${file.name}: non è un'immagine valida.`, "error");
      continue;
    }
    if (file.size > MAX_SIZE) {
      toast(`${file.name}: file troppo grande (max ${formatBytes(MAX_SIZE)}).`, "error");
      continue;
    }
    pendingUploads.push({
      file,
      url: URL.createObjectURL(file),
      name: file.name.replace(/\.[^/.]+$/, ""),
      private: true,
    });
  }
  renderPendingUploads();
}

async function confirmPendingUploads() {
  const toAdd = pendingUploads;
  clearPendingUploads();
  for (const entry of toAdd) {
    await addCharacterFromBlob(entry.file, entry.name, !entry.private);
  }
  toast(`${toAdd.length} personaggio/i caricato/i.`, "success");
}

export async function initCharacters() {
  await loadAll();
  renderGrid();

  qs("#character-upload").addEventListener("change", (e) => {
    if (e.target.files?.length) handleUpload(e.target.files);
    e.target.value = "";
  });
  qs("#character-camera-upload").addEventListener("change", (e) => {
    if (e.target.files?.length) handleUpload(e.target.files);
    e.target.value = "";
  });
  qs("#character-pending-confirm-btn").addEventListener("click", confirmPendingUploads);
  qs("#character-pending-cancel-btn").addEventListener("click", () => {
    clearPendingUploads();
    toast("Caricamento annullato.", "info");
  });
}
