// Italian -> English translation for prompt generation.
// Primary path: MyMemory public translation API (free, no key, CORS-enabled).
// Fallback path: local IT->EN dictionary, used when the API is unreachable
// (e.g. the browser has no internet access while ComfyUI runs fully local).

const MYMEMORY_ENDPOINT = "https://api.mymemory.translated.net/get";

// Small but useful glossary geared towards comic/illustration prompts.
// Longer phrases are matched first so multi-word terms translate correctly.
const DICTIONARY_PHRASES = [
  ["primo piano", "close-up"],
  ["primissimo piano", "extreme close-up"],
  ["campo lungo", "wide shot"],
  ["piano medio", "medium shot"],
  ["luce drammatica", "dramatic lighting"],
  ["controluce", "backlight"],
  ["capelli rossi", "red hair"],
  ["capelli neri", "black hair"],
  ["capelli biondi", "blonde hair"],
  ["occhi azzurri", "blue eyes"],
  ["occhi verdi", "green eyes"],
  ["armatura scintillante", "shining armor"],
  ["sfondo urbano", "urban background"],
  ["cielo stellato", "starry sky"],
  ["mani deformi", "deformed hands"],
];

const DICTIONARY_WORDS = {
  ragazza: "girl", ragazzo: "boy", donna: "woman", uomo: "man",
  bambino: "child", bambina: "child", guerriero: "warrior", guerriera: "warrior",
  eroe: "hero", eroina: "heroine", cattivo: "villain", mostro: "monster",
  robot: "robot", drago: "dragon", cavaliere: "knight", mago: "wizard",
  strega: "witch", pirata: "pirate", ninja: "ninja", samurai: "samurai",
  città: "city", foresta: "forest", montagna: "mountain", spiaggia: "beach",
  spazio: "space", castello: "castle", nave: "ship", astronave: "spaceship",
  strada: "street", cielo: "sky", tramonto: "sunset", alba: "dawn",
  notte: "night", giorno: "day", pioggia: "rain", neve: "snow",
  fuoco: "fire", fumo: "smoke", nebbia: "fog", tempesta: "storm",
  rosso: "red", blu: "blue", verde: "green", giallo: "yellow",
  nero: "black", bianco: "white", viola: "purple", arancione: "orange",
  grande: "big", piccolo: "small", veloce: "fast", forte: "strong",
  bello: "beautiful", bella: "beautiful", spaventoso: "scary", elegante: "elegant",
  armatura: "armor", spada: "sword", scudo: "shield", arco: "bow",
  pistola: "gun", mantello: "cloak", casco: "helmet", ali: "wings",
  correndo: "running", volando: "flying", combattendo: "fighting",
  saltando: "jumping", sorridendo: "smiling", urlando: "screaming",
  piangendo: "crying", camminando: "walking", seduto: "sitting", seduta: "sitting",
  in: "in", con: "with", e: "and", il: "the", la: "the", di: "of",
  su: "on", sotto: "under", vicino: "near", davanti: "in front of",
  dietro: "behind", sopra: "above", tra: "between",
};

function localDictionaryTranslate(text) {
  let result = text;
  for (const [it, en] of DICTIONARY_PHRASES) {
    result = result.replace(new RegExp(it, "gi"), en);
  }
  result = result
    .split(/(\s+|[,.;:!?])/)
    .map((token) => {
      const clean = token.toLowerCase().trim();
      if (!clean || !DICTIONARY_WORDS[clean]) return token;
      const translated = DICTIONARY_WORDS[clean];
      const isCapitalized = /^[A-Z]/.test(token);
      return isCapitalized ? translated[0].toUpperCase() + translated.slice(1) : translated;
    })
    .join("");
  return result;
}

// MyMemory's free/anonymous tier rejects any single request over ~500
// characters — but instead of a real HTTP error it replies HTTP 200 with
// the literal string "QUERY LENGTH LIMIT EXCEEDED, MAX ALLOWED QUERY : 500
// CHARS" as the "translation", so a naive caller happily treats that error
// message as real translated text and it ends up baked into the prompt.
const MYMEMORY_MAX_CHARS = 480; // safety margin under their ~500 char cap

function isMyMemoryLengthError(text) {
  return /QUERY LENGTH LIMIT EXCEEDED/i.test(text || "");
}

// Splits text into pieces that fit MyMemory's per-request limit, preferring
// sentence boundaries so translation quality isn't hurt by a mid-sentence
// cut; a single sentence longer than the limit is hard-split as a last resort.
function splitForTranslation(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
    while (current.length > maxChars) {
      chunks.push(current.slice(0, maxChars));
      current = current.slice(maxChars);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function myMemoryTranslateChunk(text) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const params = new URLSearchParams({ q: text, langpair: "it|en" });
    const response = await fetch(`${MYMEMORY_ENDPOINT}?${params.toString()}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Translation API responded ${response.status}`);
    const data = await response.json();
    const translated = data?.responseData?.translatedText;
    if (!translated || isMyMemoryLengthError(translated)) {
      throw new Error("Translation API rejected the request (query too long or empty response)");
    }
    return translated;
  } finally {
    clearTimeout(timeout);
  }
}

async function myMemoryTranslate(text) {
  const chunks = splitForTranslation(text, MYMEMORY_MAX_CHARS);
  const translatedChunks = [];
  for (const chunk of chunks) {
    translatedChunks.push(await myMemoryTranslateChunk(chunk));
  }
  return translatedChunks.join(" ");
}

/**
 * Translates Italian text to English.
 * Returns { text, source } where source is "api" or "dictionary".
 */
export async function translateItToEn(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return { text: "", source: "none" };

  try {
    const translated = await myMemoryTranslate(trimmed);
    return { text: translated, source: "api" };
  } catch {
    return { text: localDictionaryTranslate(trimmed), source: "dictionary" };
  }
}

const QUALITY_BOOSTERS = "highly detailed, sharp focus, professional illustration, 4k";

// A solid, widely-used baseline negative prompt covering the most common
// anatomy artifacts in AI-generated figures. Always included in the
// negative prompt (on top of anything the user adds) so correct anatomy
// isn't something the user has to remember to ask for every time.
export const DEFAULT_NEGATIVE_EN =
  "deformed hands, extra fingers, missing fingers, fused fingers, too many fingers, " +
  "mutated hands, poorly drawn hands, malformed limbs, extra limbs, missing limbs, " +
  "disfigured, bad anatomy, distorted body proportions, asymmetrical face, cross-eyed, " +
  "extra heads, cloned face, long neck, cropped head, cropped forehead, cropped face, " +
  "head cut off, head out of frame, top of head missing, blurry, low quality, worst quality, " +
  "jpeg artifacts, watermark, signature, text, username";

function dedupeTags(parts) {
  const seen = new Set();
  const deduped = [];
  for (const part of parts.join(", ").split(",").map((p) => p.trim()).filter(Boolean)) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(part);
  }
  return deduped.join(", ");
}

/**
 * Turns free-form translated text into a comma-separated tag-style prompt,
 * the format most ComfyUI checkpoints/LoRAs expect, and appends the chosen
 * style plus quality boosters. Intended for the positive prompt only.
 */
export function optimizePrompt(englishText, { style = "", extraTags = [] } = {}) {
  const cleaned = (englishText || "")
    .split(/\.\s*|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");

  return dedupeTags([cleaned, style, ...extraTags, QUALITY_BOOSTERS]);
}

/**
 * Same tag-style cleanup as optimizePrompt but without style/quality
 * boosters — for the negative prompt, where those wouldn't make sense.
 */
export function tagify(englishText, extraTags = []) {
  const cleaned = (englishText || "")
    .split(/\.\s*|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");

  return dedupeTags([cleaned, ...extraTags]);
}
