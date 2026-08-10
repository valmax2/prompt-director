// Two narrow, best-effort prompt rewriters for the "4. Traduci" step in
// Crea Scena — both operate on the already-translated English scene text,
// AFTER "Traduci & Ottimizza", and rewrite it in place before it's sent to
// ComfyUI or an external AI.
//
// Scope on purpose: this only softens common action/violence phrasing that
// legitimately over-trips external AI content filters on ordinary comic
// battle/action panels (a well-known false-positive problem for
// illustrators), and only reworks NAMED copyrighted characters into a
// generic original-design description. It does not touch sexual content,
// self-harm, or anything else outside comic-book action framing — there is
// no "softer phrasing" for that, so it's simply left untouched.

// --- 🛡️ Reduce false-positive AI refusals on ordinary comic action scenes ---

// Longer/more specific phrases first, so e.g. "blood splatter" matches
// before the bare "blood" rule would fire on the same text.
const REFUSAL_SOFTENERS = [
  [/blood[\s-]?splatter/gi, "dramatic red splash effect"],
  [/blood[\s-]?soaked/gi, "battle-worn"],
  [/bloody/gi, "battle-worn"],
  [/\bblood\b/gi, "red battle effects"],
  [/gruesome/gi, "dramatic and intense"],
  [/\bgory\b/gi, "intensely dramatic"],
  [/\bgore\b/gi, "intense action damage"],
  [/severed (head|limb|arm|hand)/gi, "dramatically damaged armor piece"],
  [/dead bodies/gi, "fallen figures"],
  [/dead body/gi, "fallen figure"],
  [/\bcorpse(s)?\b/gi, "fallen figure$1"],
  [/\bmassacre\b/gi, "large battle"],
  [/\bdecapitat(ed|ing|e)\b/gi, "dramatically defeated"],
  [/\bbrutally\b/gi, "intensely"],
  [/\bbrutal\b/gi, "intense"],
  [/\btortur(e|ed|ing)\b/gi, "intense interrogation"],
  [/\bmurder(ed|ing)?\b/gi, "confrontation"],
  [/\bkilling\b/gi, "defeating"],
  [/\bkilled\b/gi, "defeated"],
  [/\bto kill\b/gi, "to defeat"],
  [/\bscreaming in pain\b/gi, "reacting dramatically"],
];

// Applied only when at least one softener above actually matched — framing
// the whole thing as clearly stylized fiction is exactly the context that
// makes classifiers less likely to flag ordinary action content, but there's
// no reason to bolt it onto a prompt that had nothing to soften in the first
// place.
const FICTION_FRAMING_TAG = "clearly fictional stylized comic book illustration, non-graphic";

export function optimizeForAiAcceptance(text) {
  if (!text) return { text: text || "", matched: false };
  let result = text;
  let matched = false;
  for (const [pattern, replacement] of REFUSAL_SOFTENERS) {
    if (pattern.test(result)) {
      matched = true;
      result = result.replace(pattern, replacement);
    }
  }
  if (matched) result = `${result}, ${FICTION_FRAMING_TAG}`;
  return { text: result, matched };
}

// --- 🎭 Swap named copyrighted characters for a generic similar description ---

// A hand-picked starter list of frequently-requested characters (Italian and
// English names both, since the scene text can carry either depending on
// whether MyMemory's translator recognized the name as a proper noun and
// left it alone). Nowhere near exhaustive — anything not listed here just
// won't be rewritten, and the toast in prompts.js says so.
const CHARACTER_ALIASES = [
  [/topolino|mickey mouse/gi, "a cheerful round-eared cartoon mouse character in red shorts and white gloves, classic animated style"],
  [/paperino|donald duck/gi, "a feisty cartoon duck character in a sailor shirt and cap, classic animated style"],
  [/biancaneve|snow white/gi, "a gentle princess character with pale skin, dark hair, and a colorful puffed-sleeve dress, classic fairy tale style"],
  [/cenerentola|cinderella/gi, "a graceful princess character in a blue ball gown with glass slippers, classic fairy tale style"],
  [/la sirenetta|the little mermaid|\bariel\b/gi, "a mermaid princess character with long red hair and a green tail, classic fairy tale style"],
  // "Elsa"/"Anna" (Frozen) are deliberately NOT in this list on their own —
  // both are common real first names, and blindly rewriting every character
  // called Anna or Elsa would wreck plenty of original, non-infringing
  // characters. Only rewrite when "Frozen" itself is mentioned alongside.
  [/\bfrozen\b.*\belsa\b|\belsa\b.*\bfrozen\b/gi, "an ice-powered princess character with platinum blonde braided hair and a shimmering pale blue gown"],
  [/\bfrozen\b.*\banna\b|\banna\b.*\bfrozen\b/gi, "an adventurous princess character with strawberry-blonde hair in braids"],
  [/\bsimba\b/gi, "a young lion cub character with golden fur and a tuft of red-brown mane, African savanna setting"],
  [/\bwoody\b/gi, "a cowboy-styled toy character with a plaid shirt, cowboy hat, and a pull-string"],
  [/buzz lightyear/gi, "a space-ranger toy character in a white and green spacesuit with wings"],
  [/spider-?man|uomo ragno/gi, "a masked superhero character in a form-fitting red and blue suit with web-like patterns"],
  [/iron man/gi, "a superhero character in a high-tech red and gold powered armor suit"],
  [/\bbatman\b/gi, "a dark superhero character in a black bat-themed suit and flowing cape"],
  [/\bsuperman\b/gi, "a superhero character in a blue suit with a red cape and a stylized chest emblem"],
  [/wonder woman/gi, "a warrior superheroine character with a golden tiara, red and blue outfit, and a golden lasso"],
  [/\bpikachu\b/gi, "a small yellow electric rodent creature character with red cheeks and a lightning-bolt-shaped tail"],
  [/hello kitty/gi, "a minimalist white cartoon cat character with a red bow"],
  [/spongebob/gi, "a yellow rectangular sea-sponge cartoon character in a white shirt and red tie"],
  [/harry potter/gi, "a young wizard character with round glasses, a lightning-bolt scar, and a robed school uniform"],
  [/\byoda\b/gi, "a small wise green alien creature character with large pointed ears"],
  [/darth vader/gi, "a tall imposing armored villain character in black with a caped helmet"],
];

// When the whole request is framed as "in Disney style" etc. rather than a
// specific character, the franchise/brand word itself is the part an AI is
// likely to refuse on — swapped for a same-flavor generic style descriptor.
const FRANCHISE_STYLE_WORDS = [
  [/\bdisney\b/gi, "colorful family-friendly animated cartoon"],
  [/\bpixar\b/gi, "3D animated family film"],
  [/\bmarvel\b/gi, "modern comic book superhero"],
  [/\bdc comics\b/gi, "dark comic book superhero"],
  [/pok[eé]mon/gi, "creature-collecting animated"],
  [/star wars/gi, "science-fantasy space opera"],
  [/\bnintendo\b/gi, "colorful video game"],
];

export function optimizeForCopyrightSafety(text) {
  if (!text) return { text: text || "", matched: false };
  let result = text;
  let matched = false;
  for (const [pattern, replacement] of CHARACTER_ALIASES) {
    if (pattern.test(result)) {
      matched = true;
      result = result.replace(pattern, replacement);
    }
  }
  for (const [pattern, replacement] of FRANCHISE_STYLE_WORDS) {
    if (pattern.test(result)) {
      matched = true;
      result = result.replace(pattern, replacement);
    }
  }
  return { text: result, matched };
}
