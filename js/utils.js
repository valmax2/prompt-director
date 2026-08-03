export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else if (value !== false && value !== null && value !== undefined) {
      node.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "avi", "mkv"]);

export function fileExtension(filename) {
  const m = /\.([a-zA-Z0-9]+)$/.exec(filename || "");
  return m ? m[1].toLowerCase() : "";
}

// GIF/WEBP animate natively inside a plain <img>, so only real video
// containers (mp4/webm/...) need a <video> element instead.
export function isVideoFilename(filename) {
  return VIDEO_EXTENSIONS.has(fileExtension(filename));
}

// Object URLs from URL.createObjectURL() stay alive (and keep their backing
// Blob's memory pinned) until explicitly revoked — a plain "wipe innerHTML
// and rebuild" render that creates a fresh URL per item every time leaks the
// previous render's URLs forever. This tracks everything handed out since
// the last reset() so a full-grid re-render can free them all in one call.
export function createObjectUrlTracker() {
  let urls = [];
  return {
    create(blob) {
      const url = URL.createObjectURL(blob);
      urls.push(url);
      return url;
    },
    reset() {
      for (const url of urls) URL.revokeObjectURL(url);
      urls = [];
    },
  };
}

export function thumbWithPrivacyToggle(url, alt, isHidden, onToggle, isVideo = false) {
  const media = isVideo
    ? el("video", { src: url, class: isHidden ? "blurred" : "", controls: true, muted: true, loop: true, playsinline: true })
    : el("img", { src: url, alt, loading: "lazy", class: isHidden ? "blurred" : "" });
  const btn = el(
    "button",
    {
      class: "eye-toggle-btn",
      type: "button",
      title: isHidden ? "Mostra" : "Nascondi (privacy)",
      onclick: onToggle,
    },
    isHidden ? "🙈" : "👁️"
  );
  return el("div", { class: "thumb-wrap" }, [media, btn]);
}

export function uid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export function toast(message, type = "info", timeout = 3500) {
  const root = qs("#toast-root");
  if (!root) return;
  const node = el("div", { class: `toast ${type}`, text: message });
  root.appendChild(node);
  setTimeout(() => node.remove(), timeout);
}

export function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function formatDate(ts) {
  try {
    return new Date(ts).toLocaleString("it-IT");
  } catch {
    return "";
  }
}

export async function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function copyToClipboard(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy method
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

async function toPngBlob(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
}

/**
 * Copies an image to the system clipboard (as PNG, the most broadly
 * supported clipboard image format) so it can be pasted directly into
 * another app/site — e.g. attaching a character reference photo in
 * ChatGPT's own chat input. Returns false if unsupported so callers can
 * fall back to a plain download.
 */
export async function copyImageToClipboard(blob) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return false;
  try {
    const pngBlob = await toPngBlob(blob);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
    return true;
  } catch {
    return false;
  }
}

// Lets the user pick exactly where a file is saved (folder + name), instead
// of it always landing wherever the browser's default download location is.
// Only Chromium-based browsers support the native "Save As" picker
// (window.showSaveFilePicker); everything else falls back to the classic
// auto-download, so this never breaks saving anywhere, it just adds a
// choice where the browser allows it.
export async function downloadBlob(blob, filename) {
  if (window.showSaveFilePicker) {
    try {
      const dotIndex = filename.lastIndexOf(".");
      const ext = dotIndex > 0 ? filename.slice(dotIndex) : "";
      const pickerOptions = { suggestedName: filename };
      if (blob.type && ext) {
        pickerOptions.types = [{ description: "File", accept: { [blob.type]: [ext] } }];
      }
      const handle = await window.showSaveFilePicker(pickerOptions);
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err?.name === "AbortError") return; // user cancelled the save dialog — nothing more to do
      // Any other error (e.g. an unsupported type filter): fall through to the classic download below.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function sanitizeFilename(name) {
  return String(name).replace(/[^a-zA-Z0-9 ._-]/g, "").trim().slice(0, 120) || "senza-nome";
}
