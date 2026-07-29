import { qs, el, uid, toast, formatDate } from "./utils.js";
import { getFullDirectorState, setFullDirectorState } from "./director.js";
import { getSceneDraftForSaving, applySceneDraft } from "./prompts.js";

// Saved "scenes" are a full snapshot of the Crea Scena setup — scene text,
// character, camera/lighting/composition — NOT the generated image, so the
// whole configuration can be reloaded and tweaked again later.

const STORAGE_KEY = "comic-studio:saved-scenes";

function loadScenes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveScenes(scenes) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scenes));
}

function renderList() {
  const root = qs("#scenes-list");
  root.innerHTML = "";
  const scenes = loadScenes();

  if (scenes.length === 0) {
    root.appendChild(el("p", { class: "hint" }, "Nessuna scena salvata."));
    return;
  }

  for (const scene of [...scenes].reverse()) {
    const metaParts = [formatDate(scene.createdAt)];
    const characterNames = (scene.prompt?.characterNames || (scene.prompt?.characterName ? [scene.prompt.characterName] : [])).filter(Boolean);
    if (characterNames.length > 0) metaParts.push(characterNames.join(" + "));

    const card = el("div", { class: "item-card" }, [
      el("div", { class: "name", text: scene.name }),
      el("div", { class: "meta", text: metaParts.join(" · ") }),
      el("div", { class: "meta", text: (scene.prompt?.sceneIt || "").slice(0, 90) }),
      el("div", { class: "row" }, [
        el("button", {
          class: "btn small",
          type: "button",
          onclick: () => loadScene(scene.id),
        }, "📂 Carica"),
        el("button", {
          class: "btn small danger",
          type: "button",
          onclick: () => removeScene(scene.id),
        }, "Elimina"),
      ]),
    ]);
    root.appendChild(card);
  }
}

function loadScene(id) {
  const scene = loadScenes().find((s) => s.id === id);
  if (!scene) return;
  setFullDirectorState(scene.director);
  applySceneDraft(scene.prompt);
  toast(`Scena "${scene.name}" caricata.`, "success");
}

function removeScene(id) {
  saveScenes(loadScenes().filter((s) => s.id !== id));
  renderList();
  toast("Scena eliminata.", "info");
}

function handleSave() {
  const nameInput = qs("#scene-name-input");
  const promptDraft = getSceneDraftForSaving();

  if (!promptDraft.sceneIt.trim()) {
    toast("Scrivi prima una descrizione della scena.", "error");
    return;
  }

  const name = nameInput.value.trim() || `Scena ${new Date().toLocaleString("it-IT")}`;
  const scene = {
    id: uid(),
    name,
    createdAt: Date.now(),
    director: getFullDirectorState(),
    prompt: promptDraft,
  };

  const scenes = loadScenes();
  scenes.push(scene);
  saveScenes(scenes);
  nameInput.value = "";
  renderList();
  toast(`Scena "${name}" salvata.`, "success");
}

export function initScenes() {
  qs("#scene-save-btn").addEventListener("click", handleSave);
  renderList();
}
