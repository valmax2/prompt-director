// Thin client around Google Identity Services (auth) + the Drive REST API
// (v3). Deliberately knows nothing about characters/workflows/archive
// images — see backup.js for the app-specific sync logic built on top, so
// this file stays a pure, generically testable Drive client.

const CLIENT_ID = "445226499041-vbni0pg4cs6l1qpkltpmj6dtn8715o3b.apps.googleusercontent.com";
// drive.file: the app can only see/manage files IT created — never the rest
// of the user's Drive. Deliberately the narrowest scope that still lets us
// read back what we wrote (needed to pull onto a second device).
const SCOPES = "https://www.googleapis.com/auth/drive.file";
const APP_FOLDER_NAME = "Comic Studio";
const FOLDER_ID_KEY = "comic-studio:drive-folder-id";
const CONNECTED_EMAIL_KEY = "comic-studio:drive-email";

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;

function gisAvailable() {
  return typeof window !== "undefined" && !!window.google?.accounts?.oauth2;
}

export function isDriveSupported() {
  return gisAvailable();
}

export function isDriveConnected() {
  return !!accessToken && Date.now() < tokenExpiresAt;
}

export function getConnectedEmail() {
  return localStorage.getItem(CONNECTED_EMAIL_KEY) || "";
}

// Cached locally as soon as findAppFolderId() has resolved it once (see
// below) — null until then, e.g. before the very first sync.
export function getAppFolderId() {
  return localStorage.getItem(FOLDER_ID_KEY) || null;
}

function ensureTokenClient() {
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: () => {}, // replaced per-call in requestDriveAccess()
    });
  }
  return tokenClient;
}

async function fetchConnectedEmail() {
  try {
    const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=user", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.user?.emailAddress) localStorage.setItem(CONNECTED_EMAIL_KEY, data.user.emailAddress);
  } catch {
    // Display-only detail — the connection itself already succeeded without it.
  }
}

// Opens Google's consent popup (first time / once the previous grant has
// been revoked) or silently reuses the existing grant otherwise. Resolves
// once a usable access token is held.
export function requestDriveAccess() {
  return new Promise((resolve, reject) => {
    if (!gisAvailable()) {
      reject(new Error("La libreria di accesso Google non è ancora pronta: verifica la connessione internet e riprova tra un istante."));
      return;
    }
    const client = ensureTokenClient();
    client.callback = async (response) => {
      if (response.error) {
        reject(new Error(`Accesso a Google Drive negato o annullato (${response.error}).`));
        return;
      }
      accessToken = response.access_token;
      tokenExpiresAt = Date.now() + (Number(response.expires_in) || 3500) * 1000;
      await fetchConnectedEmail();
      resolve(accessToken);
    };
    client.requestAccessToken({ prompt: accessToken ? "" : "consent" });
  });
}

export function disconnectDrive() {
  if (accessToken && gisAvailable()) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
  localStorage.removeItem(CONNECTED_EMAIL_KEY);
  localStorage.removeItem(FOLDER_ID_KEY);
}

async function ensureToken() {
  if (isDriveConnected()) return accessToken;
  return requestDriveAccess();
}

async function driveFetch(url, options = {}) {
  const token = await ensureToken();
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Drive ha risposto ${res.status}: ${text || res.statusText}`);
  }
  return res;
}

// syncKind() runs three of these concurrently (character/workflow/archive
// adapters via Promise.all) — without de-duping the in-flight lookup, all
// three would independently see "no folder yet" and each create their own
// "Comic Studio" folder. Sharing one in-flight promise means only the first
// caller does the lookup/create; the other two just await its result.
let folderIdPromise = null;

function findAppFolderId() {
  const cached = localStorage.getItem(FOLDER_ID_KEY);
  if (cached) return Promise.resolve(cached);
  if (!folderIdPromise) {
    folderIdPromise = (async () => {
      const query = encodeURIComponent(`name='${APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
      const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`);
      const data = await res.json();
      if (data.files?.[0]?.id) {
        localStorage.setItem(FOLDER_ID_KEY, data.files[0].id);
        return data.files[0].id;
      }
      const createRes = await driveFetch("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: APP_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
      });
      const created = await createRes.json();
      localStorage.setItem(FOLDER_ID_KEY, created.id);
      return created.id;
    })().finally(() => {
      folderIdPromise = null;
    });
  }
  return folderIdPromise;
}

// `localId`/`kind` are stashed as Drive appProperties so a later sync pass
// can match a Drive file back to (or recognize it's missing from) the local
// IndexedDB record it came from, without relying on filenames staying unique.
export async function uploadToDrive({ localId, kind, name, blob }) {
  const folderId = await findAppFolderId();
  const metadata = { name, parents: [folderId], appProperties: { localId, kind } };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", blob, name);
  const res = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,appProperties", {
    method: "POST",
    body: form,
  });
  return res.json();
}

export async function listDriveFiles(kind) {
  const folderId = await findAppFolderId();
  const query = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType,modifiedTime,appProperties)&pageSize=1000`
  );
  const data = await res.json();
  const files = data.files || [];
  return kind ? files.filter((f) => f.appProperties?.kind === kind) : files;
}

export async function downloadDriveFileBlob(fileId) {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return res.blob();
}

// Generic push/pull pass for one "kind" of local data (character, workflow,
// archiveImage) against the app's Drive folder — the same loop drives every
// data type, so adding a fourth kind later never means copy-pasting this
// logic again. `adapter` describes only what's specific to that kind:
//   kind: string
//   list(): [{ id, driveFileId }]         (plus whatever toUploadBlob needs)
//   toUploadBlob(item): Promise<Blob>
//   fileNameFor(item): string
//   markSynced(id, driveFileId): Promise
//   restoreFromDrive(name, blob, driveFileId): Promise
export async function syncKind(adapter) {
  const items = adapter.list();
  const driveFiles = await listDriveFiles(adapter.kind);
  const driveByLocalId = new Map(driveFiles.filter((f) => f.appProperties?.localId).map((f) => [f.appProperties.localId, f]));
  // NOT the same as matching on the Drive file's stored localId: a file
  // downloaded onto a second device is saved under a freshly generated
  // local id (this device never had the original one), so the only
  // reliable "already downloaded" check is "some local record already
  // links to this exact Drive file id" — matching on the original
  // uploader's localId would re-download (and duplicate) it every sync.
  const linkedDriveFileIds = new Set(items.filter((i) => i.driveFileId).map((i) => i.driveFileId));

  let uploaded = 0;
  for (const item of items) {
    if (item.driveFileId) continue; // already linked to a Drive file
    const existing = driveByLocalId.get(item.id);
    if (existing) {
      // Drive already has a file for this local item (e.g. uploaded from
      // another session before the link was saved) — link it instead of
      // uploading a duplicate.
      await adapter.markSynced(item.id, existing.id);
      continue;
    }
    const blob = await adapter.toUploadBlob(item);
    const created = await uploadToDrive({ localId: item.id, kind: adapter.kind, name: adapter.fileNameFor(item), blob });
    await adapter.markSynced(item.id, created.id);
    uploaded++;
  }

  let downloaded = 0;
  for (const file of driveFiles) {
    if (linkedDriveFileIds.has(file.id)) continue; // already downloaded and linked locally
    const blob = await downloadDriveFileBlob(file.id);
    await adapter.restoreFromDrive(file.name, blob, file.id);
    downloaded++;
  }

  return { uploaded, downloaded };
}
