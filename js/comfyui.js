import { baseUrlFromSettings } from "./state.js";

export class ComfyUIError extends Error {}

export class ComfyUIClient {
  constructor(settings) {
    this.settings = settings;
    this.baseUrl = baseUrlFromSettings(settings);
    if (!this.baseUrl) {
      throw new ComfyUIError("Impostazioni di connessione mancanti o incomplete.");
    }
  }

  _authHeaders() {
    const headers = {};
    const { user, pass } = this.settings;
    if (user) {
      headers["Authorization"] = "Basic " + btoa(`${user}:${pass || ""}`);
    } else if (pass) {
      headers["Authorization"] = `Bearer ${pass}`;
    }
    return headers;
  }

  async _fetch(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers: { ...this._authHeaders(), ...(options.headers || {}) },
      });
    } catch (err) {
      throw new ComfyUIError(
        `Impossibile raggiungere ComfyUI su ${this.baseUrl}. Verifica IP/porta e che il server sia raggiungibile dal browser (CORS incluso).`
      );
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ComfyUIError(`ComfyUI ha risposto ${response.status}: ${text || response.statusText}`);
    }
    return response;
  }

  async testConnection() {
    const response = await this._fetch("/system_stats");
    return response.json();
  }

  // ComfyUI's own live node registry: for a combo/dropdown input (e.g. a
  // model filename field), the response includes the EXACT list of values
  // that node currently accepts on THIS server — the authoritative source,
  // unlike guessing from a locally uploaded/scanned model list which can go
  // stale or misjudge which folder/format a given node actually supports.
  async getObjectInfo(classType) {
    const response = await this._fetch(`/object_info/${encodeURIComponent(classType)}`);
    return response.json();
  }

  async uploadImage(blob, filename, subfolder = "") {
    // Uploading straight into ComfyUI's root input folder (no subfolder) by
    // default: it's the path format every LoadImage node unambiguously
    // understands, sidestepping any subfolder-prefix mismatch between what
    // we ask for and what ComfyUI actually reports back in its response.
    const form = new FormData();
    form.append("image", blob, filename);
    if (subfolder) form.append("subfolder", subfolder);
    form.append("overwrite", "true");
    const response = await this._fetch("/upload/image", { method: "POST", body: form });
    return response.json(); // { name, subfolder, type }
  }

  async queuePrompt(promptGraph, clientId) {
    // Deliberately NOT setting Content-Type: application/json — that header
    // value isn't CORS-safelisted, so the browser would send a preflight
    // OPTIONS request first. ComfyUI's --enable-cors-header only adds CORS
    // headers to real responses, not to OPTIONS preflights, so the
    // preflight gets no Access-Control-Allow-* headers back and the browser
    // blocks the actual POST before it's ever sent. Omitting the header
    // makes fetch default to text/plain (CORS-safelisted, no preflight);
    // ComfyUI's server parses the body as JSON regardless of the
    // Content-Type it was sent with.
    const response = await this._fetch("/prompt", {
      method: "POST",
      body: JSON.stringify({ prompt: promptGraph, client_id: clientId }),
    });
    return response.json(); // { prompt_id, number, node_errors }
  }

  async getHistory(promptId) {
    const response = await this._fetch(`/history/${promptId}`);
    return response.json();
  }

  viewImageUrl({ filename, subfolder = "", type = "output" }) {
    const params = new URLSearchParams({ filename, subfolder, type });
    return `${this.baseUrl}/view?${params.toString()}`;
  }

  _wsUrl(clientId) {
    const scheme = this.settings.protocol === "https" ? "wss" : "ws";
    return `${scheme}://${this.settings.ip}:${this.settings.port}/ws?clientId=${encodeURIComponent(clientId)}`;
  }

  /**
   * Polls /history until the queued prompt has finished, returning the list
   * of produced images. ComfyUI has no completion webhook over plain HTTP,
   * so polling is the reliable completion check; if a clientId is given, we
   * also open ComfyUI's WebSocket to relay live step progress via
   * onProgress — purely cosmetic, polling alone still detects completion if
   * the socket never connects or ComfyUI doesn't report progress.
   */
  async waitForResult(promptId, clientId, { intervalMs = 1500, timeoutMs = 20 * 60 * 1000, onProgress } = {}) {
    let ws = null;
    if (clientId && onProgress && typeof WebSocket !== "undefined") {
      try {
        ws = new WebSocket(this._wsUrl(clientId));
        ws.addEventListener("message", (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type !== "progress" || !msg.data) return;
            // Some ComfyUI versions omit prompt_id on progress events (they only
            // ever broadcast to this client's own socket, so there's nothing
            // else it could belong to) — only filter on it when it's present,
            // otherwise every progress tick gets silently dropped and the
            // percentage never appears.
            if (msg.data.prompt_id && msg.data.prompt_id !== promptId) return;
            onProgress({ value: msg.data.value, max: msg.data.max });
          } catch {
            // Non-JSON or unexpected message shape — ignore, progress is cosmetic.
          }
        });
      } catch {
        ws = null;
      }
    }

    try {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const history = await this.getHistory(promptId);
        const entry = history?.[promptId];
        if (entry?.status?.completed) {
          const images = [];
          for (const output of Object.values(entry.outputs || {})) {
            // Still images come back under "images". Animation/video output
            // nodes use different keys: Video Helper Suite's VHS_VideoCombine
            // puts its file (gif/webp/mp4/webm, regardless of actual format)
            // under "gifs" for historical reasons, and some custom nodes use
            // "videos". All three share the same {filename, subfolder, type}
            // shape, so they can be fetched via /view identically.
            for (const img of output.images || []) images.push(img);
            for (const gif of output.gifs || []) images.push(gif);
            for (const video of output.videos || []) images.push(video);
          }
          return images;
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      throw new ComfyUIError(
        "Timeout in attesa del risultato da ComfyUI (oltre 20 minuti). Il workflow potrebbe essere ancora in esecuzione sul server: controlla direttamente ComfyUI."
      );
    } finally {
      ws?.close();
    }
  }

  async fetchImageBlob(imageRef) {
    const response = await this._fetch(
      `/view?${new URLSearchParams({
        filename: imageRef.filename,
        subfolder: imageRef.subfolder || "",
        type: imageRef.type || "output",
      }).toString()}`
    );
    return response.blob();
  }
}
