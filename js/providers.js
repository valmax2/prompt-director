// Client-side integrations for external image-generation AIs, used as an
// alternative backend to a local ComfyUI instance (e.g. while away from
// home). Each provider is called directly from the browser with an API key
// the user pastes in the "IA Esterne" tab; keys are stored only in
// localStorage on the user's own device, never sent anywhere but the
// provider's official API.
//
// Meta AI is intentionally not included: it has no public third-party API
// for image generation that can be called from a browser.

import { getCustomProviderLink } from "./state.js";

export class ProviderError extends Error {}

export const PROVIDERS = [
  {
    id: "gemini",
    label: "Google Gemini",
    keyLabel: "API Key (Google AI Studio)",
    defaultModel: "gemini-2.5-flash-image",
    modelHint: "Modello Gemini con generazione immagini, es. gemini-2.5-flash-image",
    supportsReferenceImage: true,
    consumerAppUrl: "https://gemini.google.com/app",
  },
  {
    id: "openai",
    label: "OpenAI (ChatGPT / DALL·E)",
    keyLabel: "API Key (OpenAI)",
    defaultModel: "gpt-image-1",
    modelHint: "gpt-image-1, dall-e-3 o dall-e-2",
    supportsReferenceImage: true,
    consumerAppUrl: "https://chatgpt.com/",
  },
];

// "custom" isn't in PROVIDERS above since it has no fixed identity (name,
// URL) — that's whatever the user typed into the "IA personalizzata" card,
// stored via state.js rather than hardcoded here. getProviderMeta builds its
// meta on the fly from that saved link instead of looking it up statically.
export function getProviderMeta(id) {
  if (id === "custom") {
    const custom = getCustomProviderLink();
    return {
      id: "custom",
      label: custom?.name || "IA personalizzata",
      keyLabel: null,
      defaultModel: "",
      modelHint: "",
      supportsReferenceImage: true,
      consumerAppUrl: custom?.url || null,
    };
  }
  return PROVIDERS.find((p) => p.id === id) || null;
}

async function blobToBase64(blob) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return dataUrl.split(",")[1];
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

async function readErrorText(response) {
  try {
    return await response.text();
  } catch {
    return response.statusText;
  }
}

// When a reference image is attached, these general-purpose edit/generation
// APIs otherwise happily redraw the character from scratch based on the
// text alone. Telling them explicitly to preserve identity measurably
// improves resemblance (still no guarantee, unlike a dedicated
// face/character-consistency model such as IPAdapter/InstantID in ComfyUI).
function withIdentityInstruction(promptText, hasReference) {
  if (!hasReference) return promptText;
  return `Keep the exact same face, identity, hairstyle and character design as shown in the attached reference image — do not turn them into a different-looking person. Only change the scene, pose, outfit and art style as described here: ${promptText}`;
}

// --- Gemini (Google AI Studio) ---
async function generateWithGemini({ apiKey, model }, positive, negative, referenceBlob) {
  if (!apiKey) throw new ProviderError("Gemini: API key mancante.");
  const modelId = model || "gemini-2.5-flash-image";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const scenePrompt = negative ? `${positive}\n\nDa evitare: ${negative}` : positive;
  const parts = [{ text: withIdentityInstruction(scenePrompt, !!referenceBlob) }];
  if (referenceBlob) {
    parts.push({
      inlineData: { mimeType: referenceBlob.type || "image/png", data: await blobToBase64(referenceBlob) },
    });
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ["IMAGE"] },
    }),
  });
  if (!response.ok) throw new ProviderError(`Gemini ha risposto ${response.status}: ${await readErrorText(response)}`);

  const data = await response.json();
  const imageParts = (data?.candidates?.[0]?.content?.parts || []).filter((p) => p.inlineData);
  if (imageParts.length === 0) {
    throw new ProviderError("Gemini non ha restituito immagini. Verifica che il modello scelto supporti la generazione di immagini.");
  }
  return imageParts.map((p) => base64ToBlob(p.inlineData.data, p.inlineData.mimeType || "image/png"));
}

// --- OpenAI (ChatGPT / DALL-E) ---
async function generateWithOpenAI({ apiKey, model }, positive, negative, referenceBlob) {
  if (!apiKey) throw new ProviderError("OpenAI: API key mancante.");
  const modelId = model || "gpt-image-1";
  const scenePrompt = negative ? `${positive}. Da evitare: ${negative}` : positive;
  const promptText = withIdentityInstruction(scenePrompt, !!referenceBlob);

  let response;
  if (referenceBlob) {
    const form = new FormData();
    form.append("model", modelId);
    form.append("prompt", promptText);
    form.append("image", referenceBlob, "reference.png");
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    const body = { model: modelId, prompt: promptText, size: "1024x1024" };
    if (modelId.startsWith("dall-e")) body.response_format = "b64_json";
    response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
  }
  if (!response.ok) throw new ProviderError(`OpenAI ha risposto ${response.status}: ${await readErrorText(response)}`);

  const data = await response.json();
  const items = data?.data || [];
  if (items.length === 0) throw new ProviderError("OpenAI non ha restituito immagini.");

  return Promise.all(
    items.map(async (item) => {
      if (item.b64_json) return base64ToBlob(item.b64_json, "image/png");
      if (item.url) return (await fetch(item.url)).blob();
      throw new ProviderError("OpenAI: formato immagine restituito non riconosciuto.");
    })
  );
}

const GENERATORS = {
  gemini: generateWithGemini,
  openai: generateWithOpenAI,
};

/**
 * Generates image(s) via the selected external provider.
 * Returns an array of Blob.
 */
export async function generateImageExternal({ provider, settings, positive, negative, referenceBlob }) {
  if (provider === "custom") {
    throw new ProviderError(
      "L'IA personalizzata non ha un'API standard riconosciuta da questa app: usa \"Genera senza API — copia e apri\" invece."
    );
  }
  const generator = GENERATORS[provider];
  if (!generator) throw new ProviderError(`Provider sconosciuto: ${provider}`);
  if (!positive) throw new ProviderError("Prompt positivo mancante.");
  return generator(settings || {}, positive, negative || "", referenceBlob || null);
}
