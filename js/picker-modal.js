import { qs, el } from "./utils.js";

// Generic "big picker" modal: shared by lighting, lens, shot type, and style
// pickers so all three look and behave the same way (one implementation to
// keep visually consistent, per the request that this feel rich but not
// scattered/inconsistent across sections).

function closeModal() {
  qs("#picker-modal-overlay").hidden = true;
  document.removeEventListener("keydown", onKeyDown);
}

function onKeyDown(e) {
  if (e.key === "Escape") closeModal();
}

/**
 * Opens the large picker modal.
 * @param {object} opts
 * @param {string} opts.title
 * @param {Array<{title: string, options: Array}>} opts.groups - each option: {key, label, tag, description, icon (svg string)}
 * @param {string} opts.currentTag - the currently selected option's `tag`, to highlight it
 * @param {(option: object) => void} opts.onSelect - called with the chosen option; modal closes automatically
 */
export function openPickerModal({ title, groups, currentTag, onSelect }) {
  qs("#picker-modal-title").textContent = title;
  const body = qs("#picker-modal-body");
  body.innerHTML = "";

  for (const group of groups) {
    body.appendChild(el("h4", { class: "picker-group-title" }, group.title));
    const grid = el("div", { class: "picker-grid" });
    for (const option of group.options) {
      const isSelected = option.tag === currentTag;
      const iconWrap = el("div", { class: "picker-card-icon" });
      iconWrap.innerHTML = option.icon || "";
      const card = el(
        "button",
        {
          type: "button",
          class: `picker-card${isSelected ? " selected" : ""}`,
          onclick: () => {
            closeModal();
            onSelect(option);
          },
        },
        [iconWrap, el("div", { class: "picker-card-label" }, option.label), el("div", { class: "picker-card-desc" }, option.description || "")]
      );
      grid.appendChild(card);
    }
    body.appendChild(grid);
  }

  qs("#picker-modal-overlay").hidden = false;
  document.addEventListener("keydown", onKeyDown);
}

export function initPickerModal() {
  qs("#picker-modal-close-btn").addEventListener("click", closeModal);
  qs("#picker-modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "picker-modal-overlay") closeModal();
  });
}
