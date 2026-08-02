// Rich, illustrated option catalogs for the "big picker" modals — lighting,
// lens, shot type, and art style. Each entry carries the real English prompt
// tag (unchanged from what a plain <select> would have given), plus an
// Italian description and a small inline SVG so the option is recognizable
// at a glance instead of just a name in a dropdown.

let svgIdCounter = 0;
function nextSvgId(prefix) {
  svgIdCounter += 1;
  return `${prefix}-${svgIdCounter}`;
}

// A subject circle lit from `angle` degrees (0 = top, 90 = right, clockwise),
// colored `color`, with `hard` giving it a harder-edged/higher-contrast look
// (studio spotlight, chiaroscuro) instead of a soft glow.
function lightIcon(angle, color, hard = false) {
  const id = nextSvgId("lg");
  const rad = (angle * Math.PI) / 180;
  const lx = (32 + 22 * Math.sin(rad)).toFixed(1);
  const ly = (32 - 22 * Math.cos(rad)).toFixed(1);
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <defs><radialGradient id="${id}" cx="${lx}" cy="${ly}" r="34" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${color}" stop-opacity="${hard ? 1 : 0.85}"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </radialGradient></defs>
    <circle cx="32" cy="32" r="29" fill="#12162a"/>
    <circle cx="32" cy="32" r="29" fill="url(#${id})"/>
    <circle cx="32" cy="32" r="13" fill="#2a2f52" stroke="${color}" stroke-width="2"/>
    <circle cx="${lx}" cy="${ly}" r="4" fill="${color}"/>
  </svg>`;
}

function flameIcon() {
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <circle cx="32" cy="32" r="29" fill="#1a1408"/>
    <circle cx="32" cy="32" r="26" fill="#3a2508" opacity="0.8"/>
    <path d="M32 14c6 8 10 12 10 20a10 10 0 0 1-20 0c0-4 2-6 4-9-1 4 1 6 3 6 3 0 3-3 1-6 1-4 1-8 2-11z" fill="#ff9d2e"/>
    <path d="M32 26c3 4 5 7 5 11a5 5 0 0 1-10 0c0-4 3-8 5-11z" fill="#ffe08a"/>
  </svg>`;
}

function moonIcon() {
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <circle cx="32" cy="32" r="29" fill="#070a18"/>
    <circle cx="20" cy="16" r="2" fill="#cdd3ff"/>
    <circle cx="46" cy="12" r="1.4" fill="#cdd3ff"/>
    <circle cx="50" cy="24" r="1" fill="#cdd3ff"/>
    <circle cx="30" cy="18" r="8" fill="#dfe4ff"/>
    <circle cx="34" cy="15" r="7" fill="#070a18"/>
    <circle cx="32" cy="40" r="13" fill="#2a2f52" stroke="#7c8cff" stroke-width="2"/>
  </svg>`;
}

function glowIcon(color1, color2) {
  const id = nextSvgId("gw");
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <defs><radialGradient id="${id}" cx="32" cy="32" r="30" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${color1}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${color2}" stop-opacity="0.15"/>
    </radialGradient></defs>
    <circle cx="32" cy="32" r="29" fill="#0a0d1e"/>
    <circle cx="32" cy="32" r="29" fill="url(#${id})"/>
    <circle cx="32" cy="32" r="13" fill="#1c2140" stroke="${color1}" stroke-width="2"/>
  </svg>`;
}

export const LIGHTING_GROUPS = [
  {
    title: "Naturale",
    options: [
      { key: "soft-natural", label: "Naturale morbida", tag: "soft natural lighting", description: "Luce diffusa e uniforme, senza ombre dure — adatta a quasi tutte le scene.", icon: lightIcon(45, "#ffe6a8") },
      { key: "daylight", label: "Luce diurna piena", tag: "bright daylight, clear sky lighting", description: "Sole alto, luce netta e contrastata, colori vividi.", icon: lightIcon(0, "#fff3c4", true) },
      { key: "golden-hour", label: "Ora dorata (tramonto)", tag: "golden hour sunset lighting, warm glow", description: "Luce calda e radente, ombre lunghe, atmosfera dorata.", icon: lightIcon(90, "#ff9d42") },
      { key: "blue-hour", label: "Ora blu", tag: "blue hour lighting, cool twilight tones", description: "Subito dopo il tramonto: luce fredda e bluastra, atmosfera calma.", icon: lightIcon(90, "#5c8bff") },
      { key: "overcast", label: "Nuvoloso / diffusa", tag: "overcast diffused lighting, soft shadows", description: "Cielo coperto: luce piatta e morbidissima, quasi senza ombre.", icon: lightIcon(0, "#c9ccd6") },
    ],
  },
  {
    title: "Drammatica / cinema",
    options: [
      { key: "rim-dramatic", label: "Controluce drammatico", tag: "dramatic rim lighting", description: "Il soggetto è retroilluminato: bordo luminoso, resto in ombra.", icon: lightIcon(180, "#ffcf6b") },
      { key: "cinematic-backlight", label: "Controluce cinematografico", tag: "cinematic backlight, lens flare", description: "Come sopra ma con riflessi/flare della lente, effetto film.", icon: lightIcon(200, "#8bd6ff") },
      { key: "chiaroscuro", label: "Chiaroscuro", tag: "chiaroscuro lighting, high contrast, one side lit", description: "Metà volto/corpo in piena luce, l'altra quasi buia: alto contrasto pittorico.", icon: lightIcon(100, "#ffdca0", true) },
      { key: "silhouette", label: "Controluce a silhouette", tag: "silhouette lighting, subject in shadow against bright background", description: "Il soggetto diventa una sagoma scura contro uno sfondo luminoso.", icon: lightIcon(180, "#fff2cc", true) },
    ],
  },
  {
    title: "Studio",
    options: [
      { key: "studio-spot", label: "Faretto da studio", tag: "hard studio spotlight, high contrast", description: "Luce dura e direzionale da un punto preciso, ombre nette.", icon: lightIcon(45, "#ffffff", true) },
      { key: "three-point", label: "Tre punti / softbox", tag: "three-point softbox lighting, professional studio setup", description: "Illuminazione da ritratto professionale, morbida ed equilibrata.", icon: lightIcon(45, "#f2f2f2") },
      { key: "butterfly", label: "Butterfly (ritratto)", tag: "butterfly lighting, frontal beauty light", description: "Luce frontale dall'alto, tipica dei ritratti/beauty: ombra a farfalla sotto il naso.", icon: lightIcon(15, "#ffe9c2") },
    ],
  },
  {
    title: "Atmosferica",
    options: [
      { key: "neon", label: "Neon / cyberpunk", tag: "neon lighting, cyberpunk glow", description: "Luci al neon colorate, atmosfera urbana futuristica.", icon: glowIcon("#ff2fd0", "#00e5ff") },
      { key: "candlelight", label: "Candela / fuoco", tag: "warm flickering candlelight", description: "Luce calda e tremolante di una fiamma, ombre morbide e mobili.", icon: flameIcon() },
      { key: "moonlight", label: "Luce lunare notturna", tag: "cool moonlight, nighttime blue tones", description: "Notte, luce fredda e bassa, atmosfera silenziosa.", icon: moonIcon() },
      { key: "fantasy-glow", label: "Bagliore fantasy", tag: "magical glowing light, fantasy atmosphere", description: "Luce soprannaturale/magica, colori saturi e irreali.", icon: glowIcon("#9dff7a", "#7c5cff") },
    ],
  },
];

// Represents field of view: `spread` 0 (narrow/tele) .. 1 (wide/fisheye).
function lensIcon(spread) {
  const halfWidth = (6 + spread * 20).toFixed(1);
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <path d="M32 50 L${32 - halfWidth} 10 L${32 + halfWidth} 10 Z" fill="rgba(124,92,255,0.22)" stroke="#7c5cff" stroke-width="1.5"/>
    <circle cx="32" cy="50" r="7" fill="#35c98f"/>
    <circle cx="32" cy="50" r="3" fill="#12162a"/>
  </svg>`;
}

export const LENS_GROUPS = [
  {
    title: "Obiettivo",
    options: [
      { key: "wide", label: "Grandangolo", tag: "wide-angle lens shot", description: "Inquadra molto spazio, leggera distorsione ai bordi — utile per ambienti.", icon: lensIcon(1) },
      { key: "normal", label: "Normale (50mm)", tag: "standard 50mm lens perspective", description: "Prospettiva naturale, simile a come vede l'occhio umano.", icon: lensIcon(0.55) },
      { key: "telephoto", label: "Teleobiettivo", tag: "telephoto lens shot, compressed perspective", description: "Zoom stretto, sfondo compresso e sfocato, isola il soggetto.", icon: lensIcon(0.2) },
      { key: "fisheye", label: "Fisheye", tag: "fisheye lens distortion, ultra-wide curved perspective", description: "Angolo estremo con distorsione sferica marcata.", icon: lensIcon(1.3) },
      { key: "macro", label: "Macro", tag: "macro lens shot, extreme close-up detail", description: "Dettaglio ravvicinato estremo, profondità di campo minima.", icon: lensIcon(0.15) },
      { key: "tilt-shift", label: "Tilt-shift", tag: "tilt-shift lens effect, miniature-like focus falloff", description: "Sfoca in modo selettivo, effetto \"modellino in miniatura\".", icon: lensIcon(0.4) },
    ],
  },
];

function shotCropIcon(cropFraction) {
  const cropY = (8 + cropFraction * 46).toFixed(1);
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <circle cx="32" cy="16" r="9" fill="#4a5080"/>
    <path d="M18 30 L46 30 L43 54 L21 54 Z" fill="#4a5080"/>
    <rect x="16" y="54" width="9" height="8" fill="#4a5080"/>
    <rect x="39" y="54" width="9" height="8" fill="#4a5080"/>
    <rect x="0" y="${cropY}" width="64" height="${(64 - cropY).toFixed(1)}" fill="rgba(5,6,14,0.82)"/>
    <line x1="0" y1="${cropY}" x2="64" y2="${cropY}" stroke="#7c5cff" stroke-width="2" stroke-dasharray="4 3"/>
  </svg>`;
}

function birdsEyeIcon() {
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <circle cx="32" cy="32" r="29" fill="#12162a"/>
    <circle cx="32" cy="32" r="16" fill="#4a5080"/>
    <circle cx="32" cy="32" r="4" fill="#7c5cff"/>
    <text x="32" y="14" text-anchor="middle" font-size="16">📷</text>
  </svg>`;
}

function wormsEyeIcon() {
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <rect width="64" height="64" fill="#12162a"/>
    <path d="M14 60 L32 10 L50 60 Z" fill="#4a5080"/>
    <text x="32" y="56" text-anchor="middle" font-size="16">📷</text>
  </svg>`;
}

function dutchAngleIcon() {
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <rect width="64" height="64" fill="#12162a"/>
    <g transform="rotate(-18 32 32)">
      <circle cx="32" cy="18" r="8" fill="#4a5080"/>
      <rect x="20" y="28" width="24" height="28" fill="#4a5080"/>
    </g>
  </svg>`;
}

function overShoulderIcon() {
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <rect width="64" height="64" fill="#12162a"/>
    <circle cx="16" cy="46" r="13" fill="#2a2f52"/>
    <circle cx="38" cy="26" r="10" fill="#7c5cff" opacity="0.9"/>
  </svg>`;
}

function povIcon() {
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <rect width="64" height="64" fill="#12162a"/>
    <circle cx="32" cy="32" r="24" fill="none" stroke="#35c98f" stroke-width="2" stroke-dasharray="3 3"/>
    <circle cx="44" cy="24" r="9" fill="#4a5080"/>
  </svg>`;
}

function establishingIcon() {
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <rect width="64" height="64" fill="#12162a"/>
    <rect x="4" y="38" width="14" height="20" fill="#3a3f66"/>
    <rect x="22" y="26" width="12" height="32" fill="#4a5080"/>
    <rect x="38" y="34" width="16" height="24" fill="#3a3f66"/>
    <circle cx="14" cy="42" r="1.5" fill="#7c5cff"/>
  </svg>`;
}

function mirrorIcon() {
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <rect width="64" height="64" fill="#12162a"/>
    <rect x="14" y="8" width="36" height="48" rx="4" fill="none" stroke="#7c8cff" stroke-width="2"/>
    <circle cx="32" cy="26" r="7" fill="#4a5080"/>
    <path d="M22 50 L42 50 L40 34 L24 34 Z" fill="#4a5080"/>
  </svg>`;
}

export const SHOT_GROUPS = [
  {
    title: "Distanza (oltre allo zoom nel diagramma sopra)",
    options: [
      { key: "extreme-close-up", label: "Primissimo piano", tag: "extreme close-up shot", description: "Solo il viso, dettaglio massimo.", icon: shotCropIcon(0.08) },
      { key: "close-up", label: "Primo piano", tag: "close-up shot, head and shoulders", description: "Testa e spalle.", icon: shotCropIcon(0.22) },
      { key: "medium", label: "Piano medio", tag: "medium shot, waist up", description: "Dalla vita in su.", icon: shotCropIcon(0.5) },
      { key: "full-body", label: "Figura intera", tag: "full body shot, head to toe", description: "Tutto il corpo, dalla testa ai piedi.", icon: shotCropIcon(1) },
    ],
  },
  {
    title: "Angolazioni e tecniche speciali",
    options: [
      { key: "birds-eye", label: "Dall'alto (bird's eye)", tag: "bird's eye view shot, directly overhead", description: "Camera verticale dall'alto, come vista da un drone.", icon: birdsEyeIcon() },
      { key: "worms-eye", label: "Dal basso (worm's eye)", tag: "worm's eye view shot, extreme low angle", description: "Camera a terra puntata verso l'alto: il soggetto sembra imponente.", icon: wormsEyeIcon() },
      { key: "dutch-angle", label: "Inclinata (dutch angle)", tag: "dutch angle shot, tilted horizon", description: "Orizzonte inclinato: senso di tensione o disorientamento.", icon: dutchAngleIcon() },
      { key: "over-shoulder", label: "Da dietro la spalla", tag: "over-the-shoulder shot", description: "Inquadratura da dietro la spalla di un altro personaggio.", icon: overShoulderIcon() },
      { key: "pov", label: "Soggettiva (POV)", tag: "point of view shot, first-person perspective", description: "Come se guardassi con gli occhi del personaggio.", icon: povIcon() },
      { key: "establishing", label: "Campo lunghissimo (establishing)", tag: "establishing wide shot, full environment visible", description: "Inquadratura larghissima che mostra l'intero ambiente.", icon: establishingIcon() },
      { key: "mirror", label: "Riflesso / specchio", tag: "reflection shot, seen through a mirror or glass", description: "Il soggetto è visto tramite un riflesso.", icon: mirrorIcon() },
    ],
  },
];

function comicIcon() {
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <rect width="64" height="64" fill="#12162a"/>
    ${Array.from({ length: 25 }, (_, i) => {
      const x = 8 + (i % 5) * 12;
      const y = 8 + Math.floor(i / 5) * 12;
      return `<circle cx="${x}" cy="${y}" r="3.5" fill="#4a5080"/>`;
    }).join("")}
  </svg>`;
}

function inkIcon() {
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <rect width="64" height="64" fill="#12162a"/>
    <path d="M10 50 Q20 10 32 32 Q44 10 54 50" fill="none" stroke="#e8eaf6" stroke-width="4" stroke-linecap="round"/>
  </svg>`;
}

function paintIcon(color) {
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <rect width="64" height="64" fill="#12162a"/>
    <path d="M20 44c-6-10 0-24 12-28 14-4 24 8 20 20-3 9-14 8-16 16-1 5 4 6 2 10-8 2-14-8-18-18z" fill="${color}"/>
  </svg>`;
}

function cameraApertureIcon() {
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <rect width="64" height="64" fill="#12162a"/>
    <circle cx="32" cy="32" r="22" fill="none" stroke="#8bd6ff" stroke-width="2"/>
    ${Array.from({ length: 6 }, (_, i) => {
      const angle = (i * 60 * Math.PI) / 180;
      const x1 = 32 + 8 * Math.cos(angle);
      const y1 = 32 + 8 * Math.sin(angle);
      const x2 = 32 + 20 * Math.cos(angle + 0.5);
      const y2 = 32 + 20 * Math.sin(angle + 0.5);
      return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="#8bd6ff" stroke-width="2" fill="none"/>`;
    }).join("")}
  </svg>`;
}

function filmGrainIcon() {
  const dots = Array.from({ length: 30 }, () => {
    const x = (Math.random() * 60 + 2).toFixed(1);
    const y = (Math.random() * 60 + 2).toFixed(1);
    return `<circle cx="${x}" cy="${y}" r="0.8" fill="#c9a86a" opacity="0.6"/>`;
  }).join("");
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <rect width="64" height="64" fill="#2a1f12"/>
    <rect x="6" y="6" width="52" height="52" fill="none" stroke="#c9a86a" stroke-width="2"/>
    ${dots}
  </svg>`;
}

function pixelIcon() {
  const colors = ["#7c5cff", "#35c98f", "#ff9d2e", "#5c8bff"];
  const cells = Array.from({ length: 16 }, (_, i) => {
    const x = (i % 4) * 14 + 6;
    const y = Math.floor(i / 4) * 14 + 6;
    return `<rect x="${x}" y="${y}" width="12" height="12" fill="${colors[i % colors.length]}" opacity="0.85"/>`;
  }).join("");
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true"><rect width="64" height="64" fill="#12162a"/>${cells}</svg>`;
}

function cubeIcon() {
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <rect width="64" height="64" fill="#12162a"/>
    <path d="M32 8 L54 20 L54 44 L32 56 L10 44 L10 20 Z" fill="none" stroke="#8bd6ff" stroke-width="2"/>
    <path d="M32 8 L32 32 M10 20 L32 32 M54 20 L32 32" stroke="#8bd6ff" stroke-width="2"/>
  </svg>`;
}

function eyeIcon(color) {
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <rect width="64" height="64" fill="#12162a"/>
    <path d="M6 32 Q32 10 58 32 Q32 54 6 32 Z" fill="#e8eaf6"/>
    <circle cx="32" cy="32" r="11" fill="${color}"/>
    <circle cx="32" cy="32" r="5" fill="#0a0d1e"/>
  </svg>`;
}

function scribbleIcon() {
  return `<svg viewBox="0 0 64 64" width="40" height="40" aria-hidden="true">
    <rect width="64" height="64" fill="#e8eaf6"/>
    <path d="M8 40 Q20 10 32 30 Q44 50 56 20" fill="none" stroke="#2a2f52" stroke-width="2"/>
    <path d="M12 46 Q30 40 32 50 Q40 42 52 46" fill="none" stroke="#2a2f52" stroke-width="1.5"/>
  </svg>`;
}

export const STYLE_GROUPS = [
  {
    title: "Illustrato",
    options: [
      { key: "comic-classic", label: "Fumetto classico", tag: "comic book illustration, bold ink outlines, cel shading", description: "Contorni netti a inchiostro, colori piatti — stile fumetto tradizionale.", icon: comicIcon() },
      { key: "manga", label: "Manga", tag: "manga style, screentone shading, dynamic linework", description: "Bianco e nero con retini, linee dinamiche, stile giapponese.", icon: inkIcon() },
      { key: "graphic-novel", label: "Graphic novel", tag: "graphic novel, painterly digital art, moody colors", description: "Colori pittorici e atmosfera cupa/matura.", icon: paintIcon("#5c6bff") },
      { key: "american-cover", label: "Cover americana", tag: "western comic cover art, dynamic pose, halftone print", description: "Stile supereroi anni '80-'90, pose dinamiche, stampa a retino.", icon: comicIcon() },
      { key: "anime", label: "Anime", tag: "anime style illustration, vibrant colors, clean shading", description: "Stile animazione giapponese, colori vivaci, ombre pulite.", icon: eyeIcon("#7c5cff") },
      { key: "concept-art", label: "Concept art", tag: "concept art, digital painting, cinematic lighting", description: "Illustrazione digitale da pre-produzione cinematografica/videoludica.", icon: paintIcon("#35c98f") },
      { key: "pencil-sketch", label: "Schizzo a matita", tag: "pencil sketch, hand-drawn line art", description: "Disegno a matita non colorato, tratto a mano.", icon: scribbleIcon() },
    ],
  },
  {
    title: "Pittorico",
    options: [
      { key: "watercolor", label: "Acquerello", tag: "watercolor painting style, soft edges, bleeding colors", description: "Colori trasparenti e sfumati, bordi morbidi.", icon: paintIcon("#8bd6ff") },
      { key: "oil-painting", label: "Pittura a olio", tag: "oil painting style, visible brush strokes, rich texture", description: "Pennellate visibili, colori densi e ricchi.", icon: paintIcon("#ff9d2e") },
    ],
  },
  {
    title: "Fotografico",
    options: [
      { key: "photorealistic", label: "Fotorealistico", tag: "photorealistic, realistic photography, DSLR photo", description: "Aspetto di una vera fotografia, dettagli realistici.", icon: cameraApertureIcon() },
      { key: "hyperrealistic", label: "Iperrealista", tag: "hyperrealistic, ultra-detailed realism, sharp macro detail", description: "Realismo estremo, dettagli oltre la normale definizione fotografica.", icon: cameraApertureIcon() },
      { key: "vintage-film", label: "Vintage / pellicola", tag: "vintage film photography, grain, faded colors, retro tones", description: "Grana della pellicola, colori sbiaditi, atmosfera d'epoca.", icon: filmGrainIcon() },
      { key: "noir-bw", label: "Noir bianco e nero", tag: "black and white noir photography, high contrast shadows", description: "Bianco e nero drammatico, ombre nette, stile poliziesco anni '40.", icon: filmGrainIcon() },
    ],
  },
  {
    title: "Digitale",
    options: [
      { key: "3d-render", label: "Render 3D", tag: "3d render, octane render, unreal engine, cinematic", description: "Aspetto CGI moderno, luci e materiali realistici da motore 3D.", icon: cubeIcon() },
      { key: "pixel-art", label: "Pixel art", tag: "pixel art style, 16-bit retro game aesthetic", description: "Grafica a blocchi/pixel, stile videogioco retrò.", icon: pixelIcon() },
      { key: "cyberpunk-neon", label: "Cyberpunk neon", tag: "cyberpunk style, neon colors, futuristic urban aesthetic", description: "Colori al neon, ambientazione urbana futuristica.", icon: eyeIcon("#ff2fd0") },
    ],
  },
];
