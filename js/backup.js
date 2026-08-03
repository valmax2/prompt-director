import { qs, toast } from "./utils.js";
import * as drive from "./drive.js";
import { listCharactersForSync, markCharacterDriveId, restoreCharacterFromDrive } from "./characters.js";
import { listWorkflowsForSync, markWorkflowDriveId, restoreWorkflowFromDrive } from "./workflows.js";
import { listArchiveForSync, markArchiveDriveId, restoreArchiveFromDrive } from "./archive.js";

const characterAdapter = {
  kind: "character",
  list: listCharactersForSync,
  toUploadBlob: async (item) => item.blob,
  fileNameFor: (item) => `${item.name}.png`,
  markSynced: markCharacterDriveId,
  restoreFromDrive: restoreCharacterFromDrive,
};

const workflowAdapter = {
  kind: "workflow",
  list: listWorkflowsForSync,
  toUploadBlob: async (item) => new Blob([JSON.stringify(item.json)], { type: "application/json" }),
  fileNameFor: (item) => `${item.name}.json`,
  markSynced: markWorkflowDriveId,
  restoreFromDrive: async (name, blob, driveFileId) => {
    const json = JSON.parse(await blob.text());
    return restoreWorkflowFromDrive(name.replace(/\.json$/i, ""), json, driveFileId);
  },
};

const archiveAdapter = {
  kind: "archiveImage",
  list: listArchiveForSync,
  toUploadBlob: async (item) => item.blob,
  fileNameFor: (item) => item.filename || `${item.name}.png`,
  markSynced: markArchiveDriveId,
  restoreFromDrive: restoreArchiveFromDrive,
};

function setStatus(message, type = "") {
  const box = qs("#backup-status");
  if (!box) return;
  box.textContent = message;
  box.className = `status-box${type ? " " + type : ""}`;
}

function refreshConnectionUI() {
  const connected = drive.isDriveConnected();
  qs("#backup-connect-btn").hidden = connected;
  qs("#backup-disconnect-btn").hidden = !connected;
  qs("#backup-sync-btn").disabled = !connected;
  qs("#backup-open-drive-btn").disabled = !connected;
  qs("#backup-account").textContent = connected ? `Connesso come ${drive.getConnectedEmail() || "il tuo account Google"}.` : "Non connesso.";
}

// Deep-links straight into the "Comic Studio" folder once its id is known
// (after the first sync); before that, opens Drive's root as a reasonable
// fallback rather than doing nothing.
function handleOpenDrive() {
  const folderId = drive.getAppFolderId();
  const url = folderId ? `https://drive.google.com/drive/folders/${folderId}` : "https://drive.google.com/drive/my-drive";
  window.open(url, "_blank", "noopener");
}

async function runSync({ silent = false } = {}) {
  if (!drive.isDriveConnected()) {
    if (!silent) toast("Collega prima Google Drive.", "error");
    return;
  }
  const btn = qs("#backup-sync-btn");
  btn.disabled = true;
  setStatus("Sincronizzazione in corso...");
  try {
    const results = await Promise.all([drive.syncKind(characterAdapter), drive.syncKind(workflowAdapter), drive.syncKind(archiveAdapter)]);
    const uploaded = results.reduce((sum, r) => sum + r.uploaded, 0);
    const downloaded = results.reduce((sum, r) => sum + r.downloaded, 0);
    setStatus(`✅ Sincronizzato: ${uploaded} caricati su Drive, ${downloaded} scaricati da Drive.`, "ok");
    if (!silent) toast("Sincronizzazione completata.", "success");
  } catch (err) {
    setStatus(`Errore di sincronizzazione: ${err.message}`, "error");
    if (!silent) toast(`Errore di sincronizzazione: ${err.message}`, "error");
  } finally {
    btn.disabled = !drive.isDriveConnected();
  }
}

async function handleConnect() {
  try {
    await drive.requestDriveAccess();
    refreshConnectionUI();
    toast("Google Drive collegato.", "success");
    runSync({ silent: true });
  } catch (err) {
    toast(err.message, "error");
  }
}

function handleDisconnect() {
  drive.disconnectDrive();
  refreshConnectionUI();
  setStatus("");
  toast("Google Drive scollegato.", "info");
}

// Debounced so a burst of local changes (e.g. uploading several characters
// at once) triggers one sync pass instead of one per item.
let autoSyncTimer = null;
function scheduleAutoSync() {
  if (!drive.isDriveConnected()) return;
  clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => runSync({ silent: true }), 2000);
}

export function initBackup() {
  refreshConnectionUI();
  qs("#backup-connect-btn").addEventListener("click", handleConnect);
  qs("#backup-disconnect-btn").addEventListener("click", handleDisconnect);
  qs("#backup-sync-btn").addEventListener("click", () => runSync());
  qs("#backup-open-drive-btn").addEventListener("click", handleOpenDrive);

  // These events already exist (or were added alongside this feature) for
  // each store's own reasons — reusing them here means new/changed
  // characters, workflows, and archive images get backed up automatically
  // without characters.js/workflows.js/archive.js needing to import this
  // module directly (which would create a circular-import mess).
  window.addEventListener("characters-updated", scheduleAutoSync);
  window.addEventListener("workflows-updated", scheduleAutoSync);
  window.addEventListener("archive-updated", scheduleAutoSync);
}
