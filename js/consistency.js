// "Personaggio Coerente" (Character Consistency) system.
// Builds the auto-generated positive-prompt instruction block that tells the
// model which uploaded reference image covers which aspect of the character
// (identity/face vs body-costume vs pose-only), and how strongly to preserve
// each aspect vs. how freely the scene may vary — all expressed as plain
// prompt text + standard (phrase:weight) emphasis syntax, since ComfyUI has
// no universal "identity strength" node input we could target instead.

export const COHERENT_MODE_PRESETS = [
  { key: "", label: "— nessuna (usa solo la descrizione scena) —", tag: "" },
  { key: "portrait", label: "Ritratto", tag: "portrait, upper body, facing camera" },
  { key: "full-body", label: "Figura intera", tag: "full body shot, standing pose" },
  { key: "action", label: "Azione", tag: "dynamic action pose, motion, mid-movement" },
  { key: "combat", label: "Combattimento", tag: "combat pose, fighting stance, battle action" },
  { key: "run-jump", label: "Corsa / salto", tag: "running pose, mid-jump, dynamic athletic motion" },
  { key: "cinematic", label: "Scena cinematografica", tag: "cinematic scene, dramatic framing, film-still composition" },
  { key: "custom", label: "Posa personalizzata (descrivila nella scena)", tag: "" },
];

function clamp01(value, fallback = 0.7) {
  return typeof value === "number" && !Number.isNaN(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

// Standard CLIP-text-encoder emphasis syntax, understood by the large
// majority of ComfyUI text-encode nodes (CLIPTextEncode and most custom
// encoders built on the same convention) — 0 -> 0.60x, 1 -> 1.50x.
function weighted(phrase, strength01) {
  const weight = (0.6 + clamp01(strength01) * 0.9).toFixed(2);
  return `(${phrase}:${weight})`;
}

/**
 * Builds the character-consistency instruction block for the positive
 * prompt. Only ever mentions a reference role (identity/character/pose) that
 * is ACTUALLY active this generation — never references a source that
 * wasn't actually mapped+uploaded, so an unused/missing pose image never
 * shows up as a dangling instruction.
 */
export function buildConsistencyBlock({ identityActive, characterActive, poseActive, strengths = {} } = {}) {
  if (!identityActive && !characterActive && !poseActive) return "";

  const lines = [];
  if (identityActive) {
    lines.push(
      weighted(
        "preserve the exact facial identity, face structure and features, eyes, hair, apparent age and skin tone shown in the identity reference image",
        strengths.identity
      )
    );
  }
  if (characterActive) {
    lines.push(
      weighted(
        "preserve the exact body proportions, costume, materials, symbols, accessories and color palette shown in the character reference image",
        strengths.character
      )
    );
  }
  if (poseActive) {
    lines.push(
      weighted(
        "follow only the body pose and composition of the pose reference image, WITHOUT copying its identity, face or clothing",
        strengths.pose
      )
    );
  }
  if (identityActive) {
    lines.push(weighted("consistent facial identity across the whole image", strengths.faceCoherence));
  }
  if (characterActive) {
    lines.push(weighted("consistent costume and outfit details across the whole image", strengths.costumeCoherence));
  }

  const freedom = clamp01(strengths.sceneFreedom);
  if (freedom > 0.15) {
    lines.push(weighted("scene, background, action, expression, camera framing and lighting are free to change", freedom));
  }

  return lines.join(", ");
}

/**
 * Traces the workflow's own graph links to find which input field of which
 * OTHER node a given node id feeds into (API-format links are encoded as
 * `[sourceNodeId, outputIndex]`). Used only as an optional bonus precision
 * hint (e.g. confirming a LoadImage node really is wired to
 * TextEncodeQwenImageEditPlus's "image2" socket) — never required, since the
 * consistency block above is role-based and correct regardless of wiring.
 */
export function findLinkedInputField(workflowJson, sourceNodeId) {
  for (const node of Object.values(workflowJson || {})) {
    for (const [field, value] of Object.entries(node.inputs || {})) {
      if (Array.isArray(value) && value.length === 2 && String(value[0]) === String(sourceNodeId)) {
        return field;
      }
    }
  }
  return null;
}
