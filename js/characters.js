import { db } from "./db.js";
import { qs, el, uid, toast, formatBytes, formatDate, sanitizeFilename, thumbWithPrivacyToggle, copyImageToClipboard, downloadBlob } from "./utils.js";

const STORE = "characters";
const MAX_SIZE = 15 * 1024 * 1024; // 15MB per image, generous but bounded

let cache = [];

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

function renderGrid() {
  const root = qs("#character-grid");
  root.innerHTML = "";

  if (cache.length === 0) {
    root.appendChild(el("p", { class: "hint" }, "Nessun personaggio caricato."));
    return;
  }

  for (const character of cache) {
    const url = URL.createObjectURL(character.blob);
    const nameDisplay = el("div", { class: "name", text: character.name });
    const isHidden = character.visible === false;

    const card = el("div", { class: "item-card" }, [
      thumbWithPrivacyToggle(url, character.name, isHidden, async () => {
        character.visible = isHidden ? true : false;
        await db.put(STORE, character);
        renderGrid();
      }),
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
    const url = URL.createObjectURL(character.identityBlob);
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

export async function addCharacterFromBlob(blob, name) {
  const record = {
    id: uid(),
    name: sanitizeFilename(name),
    blob,
    visible: true,
    createdAt: Date.now(),
  };
  await db.put(STORE, record);
  await loadAll();
  renderGrid();
  notifyUpdated();
  return record;
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
    await addCharacterFromBlob(file, file.name.replace(/\.[^/.]+$/, ""));
  }
  toast("Personaggi caricati.", "success");
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
}
