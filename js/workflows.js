import { db } from "./db.js";
import { qs, el, uid, toast, formatDate, downloadBlob, sanitizeFilename } from "./utils.js";
import { getActiveWorkflowId, setActiveWorkflowId } from "./state.js";

const STORE = "workflows";
// "seed"/"resolution" stay single fixed nodes (each has a small, known set of
// input fields) — everything a scene needs a variable number of nodes for
// (prompt text, reference image) is handled as a variable-length group below,
// since custom/third-party nodes (e.g. TextEncodeQwenImageEdit,
// TextEncodeQwenImageEditPlus, or whatever ships next) can't be predicted by
// class_type: mapping is purely "pick any node + any input field", so it
// works for today's nodes and future ones without code changes.
const ROLES = [
  { key: "seed", label: "Seed", fields: [{ key: "field", defaultField: "seed" }] },
  {
    key: "resolution",
    label: "Risoluzione (larghezza / altezza, es. nodo EmptyLatentImage)",
    fields: [
      { key: "widthField", defaultField: "width" },
      { key: "heightField", defaultField: "height" },
    ],
  },
  {
    key: "frameCount",
    label: "Numero di frame — animazione (es. nodo AnimateDiff/batch)",
    fields: [{ key: "field", defaultField: "frame_count" }],
  },
  {
    key: "fps",
    label: "FPS — animazione (es. nodo VHS_VideoCombine)",
    fields: [{ key: "field", defaultField: "frame_rate" }],
  },
];

// Each group renders as an add/remove-able list of {nodeId, field} rows.
// `legacyKey` migrates the old single-node mapping shape (from before
// multi-node support existed) into a one-item array.
const DYNAMIC_GROUPS = [
  {
    key: "positives",
    legacyKey: "positive",
    defaultField: "text",
    title: "Prompt positivo (uno o più nodi)",
    hint: "Aggiungi un nodo per ogni encoder di testo positivo del workflow (es. CLIPTextEncode, TextEncodeQwenImageEdit, TextEncodeQwenImageEditPlus o qualsiasi nodo futuro): riceveranno tutti lo stesso prompt.",
    addLabel: "+ Aggiungi nodo prompt positivo",
    emptyHint: "Nessun nodo prompt positivo collegato.",
  },
  {
    key: "negatives",
    legacyKey: "negative",
    defaultField: "text",
    title: "Prompt negativo (uno o più nodi)",
    hint: "Aggiungi un nodo per ogni encoder di testo negativo del workflow: riceveranno tutti lo stesso prompt negativo.",
    addLabel: "+ Aggiungi nodo prompt negativo",
    emptyHint: "Nessun nodo prompt negativo collegato.",
  },
  {
    key: "images",
    legacyKey: "image",
    defaultField: "image",
    withLabel: true,
    withSource: true,
    title: "Immagini di riferimento (uno o più nodi LoadImage)",
    hint: "Aggiungi un nodo per ogni immagine di riferimento distinta che il workflow accetta. Il campo del nodo LoadImage resta sempre \"image\" (i nomi image1/image2/image3 appartengono invece al nodo TextEncodeQwenImageEditPlus a valle, non li tocchiamo qui: colleghiamo solo i nodi LoadImage a monte). Scegli anche la sorgente — Identità (volto), Personaggio (corpo/costume) o Posa (opzionale, guida solo la posa) — e un'etichetta se vuoi combinare più personaggi.",
    addLabel: "+ Aggiungi nodo immagine",
    emptyHint: "Nessun nodo immagine collegato.",
  },
];

const IMAGE_SOURCES = [
  { key: "character", label: "Personaggio (corpo / costume)" },
  { key: "identity", label: "Identità (volto)" },
  { key: "pose", label: "Posa (opzionale, solo posa/composizione)" },
];

let cache = [];
let mappingWorkflowId = null;
let currentDynamicMappings = {};

function getDynamicMappings(workflow, group) {
  if (Array.isArray(workflow.mapping?.[group.key])) return workflow.mapping[group.key];
  if (workflow.mapping?.[group.legacyKey]) return [workflow.mapping[group.legacyKey]];
  return [];
}

// A proper ComfyUI *API-format* workflow is a flat object keyed by node id,
// where every value is a { class_type, inputs, ... } node object. A regular
// (non-API) workflow save instead has top-level "nodes"/"links" arrays and
// other non-node fields (e.g. last_node_id: 25) — that shape passes a loose
// "is it an object" check but crashes ComfyUI's /prompt endpoint later with
// a cryptic server-side TypeError, since it isn't built to run directly.
function isValidWorkflowJson(json) {
  if (!json || typeof json !== "object" || Array.isArray(json) || Object.keys(json).length === 0) return false;
  if (Array.isArray(json.nodes) || Array.isArray(json.links)) return false;
  return Object.values(json).every(
    (node) => node && typeof node === "object" && !Array.isArray(node) && "class_type" in node && "inputs" in node
  );
}

async function loadAll() {
  cache = await db.getAll(STORE);
  cache.sort((a, b) => b.createdAt - a.createdAt);
  return cache;
}

export async function getWorkflowById(id) {
  return cache.find((w) => w.id === id) || db.get(STORE, id);
}

export async function getActiveWorkflow() {
  const id = getActiveWorkflowId();
  if (!id) return null;
  return getWorkflowById(id);
}

function nodeOptionsLabel(nodeId, node) {
  const title = node?._meta?.title;
  return `#${nodeId} · ${node?.class_type || "?"}${title ? " (" + title + ")" : ""}`;
}

function renderDynamicMappingRows(container, nodeEntries, list, group) {
  const { defaultField, emptyHint, withLabel, withSource } = group;
  container.innerHTML = "";
  if (list.length === 0) {
    container.appendChild(el("p", { class: "hint" }, emptyHint));
  }
  list.forEach((current, index) => {
    const nodeSelect = el(
      "select",
      { onchange: () => { current.nodeId = nodeSelect.value; } },
      [
        el("option", { value: "" }, "— non usato —"),
        ...nodeEntries.map(([nodeId, node]) =>
          el(
            "option",
            { value: nodeId, selected: current.nodeId === nodeId ? "selected" : false },
            nodeOptionsLabel(nodeId, node)
          )
        ),
      ]
    );
    const fieldInput = el("input", {
      type: "text",
      value: current.field || defaultField,
      placeholder: defaultField,
      oninput: () => { current.field = fieldInput.value; },
    });
    const rowChildren = [nodeSelect, fieldInput];
    if (withSource) {
      const sourceSelect = el(
        "select",
        { onchange: () => { current.source = sourceSelect.value; } },
        IMAGE_SOURCES.map((s) =>
          el("option", { value: s.key, selected: (current.source || "character") === s.key ? "selected" : false }, s.label)
        )
      );
      rowChildren.push(sourceSelect);
    }
    if (withLabel) {
      const labelInput = el("input", {
        type: "text",
        value: current.label || "",
        placeholder: `Etichetta (es. Personaggio ${index + 1})`,
        oninput: () => { current.label = labelInput.value; },
      });
      rowChildren.push(labelInput);
    }
    const removeBtn = el(
      "button",
      {
        class: "btn small danger",
        type: "button",
        onclick: () => {
          list.splice(index, 1);
          renderDynamicMappingRows(container, nodeEntries, list, group);
        },
      },
      "Rimuovi"
    );
    rowChildren.push(removeBtn);
    container.appendChild(el("div", { class: "row image-mapping-row" }, rowChildren));
  });
}

function renderMappingPanel(workflow) {
  const panel = qs("#workflow-mapping");
  const fieldsRoot = qs("#mapping-fields");
  qs("#mapping-workflow-name").textContent = workflow.name;
  fieldsRoot.innerHTML = "";

  const nodeEntries = Object.entries(workflow.json);

  for (const role of ROLES) {
    const current = workflow.mapping?.[role.key] || {};
    const nodeSelect = el("select", { "data-role": role.key, "data-part": "node" }, [
      el("option", { value: "" }, "— non usato —"),
      ...nodeEntries.map(([nodeId, node]) =>
        el(
          "option",
          { value: nodeId, selected: current.nodeId === nodeId ? "selected" : false },
          nodeOptionsLabel(nodeId, node)
        )
      ),
    ]);
    const fieldInputs = role.fields.map((f) =>
      el("input", {
        type: "text",
        "data-role": role.key,
        "data-part": f.key,
        value: current[f.key] || f.defaultField,
        placeholder: f.defaultField,
      })
    );
    fieldsRoot.appendChild(
      el("label", {}, [role.label, nodeSelect, ...fieldInputs])
    );
  }

  currentDynamicMappings = {};
  for (const group of DYNAMIC_GROUPS) {
    const list = getDynamicMappings(workflow, group).map((m) => ({ ...m }));
    currentDynamicMappings[group.key] = list;

    const rowsContainer = el("div", { class: "image-mappings-list" });
    renderDynamicMappingRows(rowsContainer, nodeEntries, list, group);
    const addBtn = el(
      "button",
      {
        class: "btn small",
        type: "button",
        onclick: () => {
          const entry = { nodeId: "", field: group.defaultField };
          if (group.withLabel) entry.label = "";
          if (group.withSource) entry.source = "character";
          list.push(entry);
          renderDynamicMappingRows(rowsContainer, nodeEntries, list, group);
        },
      },
      group.addLabel
    );
    fieldsRoot.appendChild(
      el("div", { class: "image-mappings-block" }, [
        el("div", { class: "step-title", text: group.title }),
        el("p", { class: "hint" }, group.hint),
        rowsContainer,
        addBtn,
      ])
    );
  }

  mappingWorkflowId = workflow.id;
  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function saveMapping() {
  if (!mappingWorkflowId) return;
  const workflow = await getWorkflowById(mappingWorkflowId);
  if (!workflow) return;
  const mapping = {};
  for (const role of ROLES) {
    const nodeSelect = qs(`select[data-role="${role.key}"][data-part="node"]`);
    const nodeId = nodeSelect?.value || "";
    if (!nodeId) continue;
    const entry = { nodeId };
    for (const f of role.fields) {
      const fieldInput = qs(`input[data-role="${role.key}"][data-part="${f.key}"]`);
      entry[f.key] = fieldInput?.value?.trim() || f.defaultField;
    }
    mapping[role.key] = entry;
  }

  for (const group of DYNAMIC_GROUPS) {
    const list = currentDynamicMappings[group.key] || [];
    mapping[group.key] = list
      .filter((m) => m.nodeId)
      .map((m) => {
        const entry = { nodeId: m.nodeId, field: (m.field || "").trim() || group.defaultField };
        if (group.withLabel) entry.label = (m.label || "").trim();
        if (group.withSource) entry.source = m.source || "character";
        return entry;
      });
  }

  workflow.mapping = mapping;
  await db.put(STORE, workflow);
  await loadAll();
  renderList();
  toast("Mappatura salvata.", "success");
  qs("#workflow-mapping").hidden = true;
  // The mapping panel can be reopened on the workflow that's already active,
  // in which case no active-workflow change event fires — this lets the
  // "Crea Scena" character slots (which depend on the image-node mapping)
  // refresh even when the active workflow's id didn't change.
  window.dispatchEvent(new CustomEvent("workflow-mapping-updated"));
}

function renderList() {
  const root = qs("#workflow-list");
  root.innerHTML = "";
  const activeId = getActiveWorkflowId();

  if (cache.length === 0) {
    root.appendChild(el("p", { class: "hint" }, "Nessun workflow caricato."));
    return;
  }

  for (const workflow of cache) {
    const isActive = workflow.id === activeId;
    const nodeCount = Object.keys(workflow.json || {}).length;
    const card = el("div", { class: `item-card${isActive ? " active-workflow" : ""}` }, [
      el("div", { class: "name", text: workflow.name }),
      el("div", { class: "meta", text: `${nodeCount} nodi · ${formatDate(workflow.createdAt)}` }),
      el("div", { class: "meta", text: isActive ? "✅ Attivo" : "" }),
      el("div", { class: "row" }, [
        el("button", {
          class: "btn small",
          type: "button",
          onclick: () => {
            setActiveWorkflowId(workflow.id);
            renderList();
            toast(`"${workflow.name}" impostato come workflow attivo.`, "success");
          },
        }, isActive ? "Attivo" : "Seleziona"),
        el("button", {
          class: "btn small",
          type: "button",
          onclick: () => renderMappingPanel(workflow),
        }, "Mappa nodi"),
        el("button", {
          class: "btn small",
          type: "button",
          title: "Scarica il file .json del workflow per aprirlo/modificarlo (es. in ComfyUI o in un editor di testo)",
          onclick: () => downloadWorkflow(workflow),
        }, "📂 Apri (scarica)"),
        el("button", {
          class: "btn small danger",
          type: "button",
          onclick: () => removeWorkflow(workflow.id),
        }, "Elimina"),
      ]),
    ]);
    root.appendChild(card);
  }
}

// Lets the user open/edit the raw ComfyUI graph outside the app (text
// editor, or re-imported into ComfyUI's own UI) — exports exactly the
// API-format JSON that was uploaded, without our app's own id/mapping
// metadata, so it stays directly re-usable in ComfyUI as-is.
function downloadWorkflow(workflow) {
  const blob = new Blob([JSON.stringify(workflow.json, null, 2)], { type: "application/json" });
  downloadBlob(blob, `${sanitizeFilename(workflow.name)}.json`);
}

async function removeWorkflow(id) {
  await db.remove(STORE, id);
  if (getActiveWorkflowId() === id) setActiveWorkflowId(null);
  await loadAll();
  renderList();
  toast("Workflow eliminato.", "info");
}

async function handleUpload(fileList) {
  for (const file of Array.from(fileList)) {
    if (!file.name.toLowerCase().endsWith(".json")) {
      toast(`${file.name}: formato non valido, atteso .json`, "error");
      continue;
    }
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (!isValidWorkflowJson(json)) {
        toast(
          `${file.name}: non è nel formato API di ComfyUI. In ComfyUI usa "Export (API)" (o "Save (API Format)" con Dev Mode attiva), non il salvataggio normale del workflow.`,
          "error",
          9000
        );
        continue;
      }
      const record = {
        id: uid(),
        name: file.name.replace(/\.json$/i, ""),
        json,
        mapping: {},
        createdAt: Date.now(),
      };
      await db.put(STORE, record);
      toast(`Workflow "${record.name}" caricato.`, "success");
    } catch (err) {
      toast(`${file.name}: errore nel parsing JSON (${err.message}).`, "error");
    }
  }
  await loadAll();
  renderList();
}

export async function initWorkflows() {
  await loadAll();
  renderList();

  qs("#workflow-upload").addEventListener("change", (e) => {
    if (e.target.files?.length) handleUpload(e.target.files);
    e.target.value = "";
  });

  qs("#mapping-save").addEventListener("click", saveMapping);
}

export function listWorkflows() {
  return cache;
}
