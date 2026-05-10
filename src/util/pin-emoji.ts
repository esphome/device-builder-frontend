/**
 * Map a SHA-256 fingerprint to a stable emoji sequence for OOB
 * visual verification.
 *
 * The hex byte block at `formatPinSha256` is technically correct
 * but operationally ignored: pairs of users staring at 64 hex
 * characters reliably skim instead of comparing. Element X
 * popularised the alternative, lifted from the Matrix
 * Short-Authentication-String (SAS) spec: split the leading bits
 * of the fingerprint into 6-bit chunks and index each chunk into
 * a fixed 64-emoji vocabulary. The result is a small row of
 * cartoony, distinctly-shaped pictures that the human eye reads
 * in one pass and either matches or doesn't, making the
 * comparison gesture itself feel meaningful instead of
 * ceremonial.
 *
 * The emoji list and indexing match v1.x of the Matrix spec
 * (https://spec.matrix.org/v1.8/client-server-api/#sas-method-emoji)
 * so that any operator who has used Element X recognises the
 * pattern. Note: we are NOT speaking the Matrix protocol; we
 * are borrowing only the UX vocabulary. The emoji-name strings
 * here are English; the visual emoji is the canonical signal,
 * and matching emoji glyphs is what protects the operator —
 * label localisation is a future follow-up that wouldn't change
 * the security property.
 *
 * Default of 7 emojis = 42 bits of identifier, mirroring the
 * Matrix SAS choice and giving comfortably more entropy than a
 * casual attacker can grind against. Caller can ask for a
 * different count if a tighter or looser display is wanted, but
 * 7 is the only count that lines up with the documented Matrix
 * UX so prefer it for cross-side comparison.
 */

export interface EmojiSlot {
  readonly emoji: string;
  readonly name: string;
}

const SAS_EMOJIS: ReadonlyArray<EmojiSlot> = [
  { emoji: "\u{1F436}", name: "Dog" },
  { emoji: "\u{1F431}", name: "Cat" },
  { emoji: "\u{1F981}", name: "Lion" },
  { emoji: "\u{1F40E}", name: "Horse" },
  { emoji: "\u{1F984}", name: "Unicorn" },
  { emoji: "\u{1F437}", name: "Pig" },
  { emoji: "\u{1F418}", name: "Elephant" },
  { emoji: "\u{1F430}", name: "Rabbit" },
  { emoji: "\u{1F43C}", name: "Panda" },
  { emoji: "\u{1F413}", name: "Rooster" },
  { emoji: "\u{1F427}", name: "Penguin" },
  { emoji: "\u{1F422}", name: "Turtle" },
  { emoji: "\u{1F41F}", name: "Fish" },
  { emoji: "\u{1F419}", name: "Octopus" },
  { emoji: "\u{1F98B}", name: "Butterfly" },
  { emoji: "\u{1F337}", name: "Flower" },
  { emoji: "\u{1F333}", name: "Tree" },
  { emoji: "\u{1F335}", name: "Cactus" },
  { emoji: "\u{1F344}", name: "Mushroom" },
  { emoji: "\u{1F30F}", name: "Globe" },
  { emoji: "\u{1F319}", name: "Moon" },
  { emoji: "\u{2601}\u{FE0F}", name: "Cloud" },
  { emoji: "\u{1F525}", name: "Fire" },
  { emoji: "\u{1F34C}", name: "Banana" },
  { emoji: "\u{1F34E}", name: "Apple" },
  { emoji: "\u{1F353}", name: "Strawberry" },
  { emoji: "\u{1F33D}", name: "Corn" },
  { emoji: "\u{1F355}", name: "Pizza" },
  { emoji: "\u{1F382}", name: "Cake" },
  { emoji: "\u{2764}\u{FE0F}", name: "Heart" },
  { emoji: "\u{1F600}", name: "Smiley" },
  { emoji: "\u{1F916}", name: "Robot" },
  { emoji: "\u{1F3A9}", name: "Hat" },
  { emoji: "\u{1F453}", name: "Glasses" },
  { emoji: "\u{1F527}", name: "Wrench" },
  { emoji: "\u{1F385}", name: "Santa" },
  { emoji: "\u{1F44D}", name: "Thumbs up" },
  { emoji: "\u{2602}\u{FE0F}", name: "Umbrella" },
  { emoji: "\u{231B}\u{FE0F}", name: "Hourglass" },
  { emoji: "\u{23F0}", name: "Clock" },
  { emoji: "\u{1F381}", name: "Gift" },
  { emoji: "\u{1F4A1}", name: "Light bulb" },
  { emoji: "\u{1F4D5}", name: "Book" },
  { emoji: "\u{270F}\u{FE0F}", name: "Pencil" },
  { emoji: "\u{1F4CE}", name: "Paperclip" },
  { emoji: "\u{2702}\u{FE0F}", name: "Scissors" },
  { emoji: "\u{1F512}", name: "Lock" },
  { emoji: "\u{1F511}", name: "Key" },
  { emoji: "\u{1F528}", name: "Hammer" },
  { emoji: "\u{260E}\u{FE0F}", name: "Telephone" },
  { emoji: "\u{1F3C1}", name: "Flag" },
  { emoji: "\u{1F682}", name: "Train" },
  { emoji: "\u{1F6B2}", name: "Bicycle" },
  { emoji: "\u{2708}\u{FE0F}", name: "Aeroplane" },
  { emoji: "\u{1F680}", name: "Rocket" },
  { emoji: "\u{1F3C6}", name: "Trophy" },
  { emoji: "\u{26BD}\u{FE0F}", name: "Ball" },
  { emoji: "\u{1F3B8}", name: "Guitar" },
  { emoji: "\u{1F3BA}", name: "Trumpet" },
  { emoji: "\u{1F514}", name: "Bell" },
  { emoji: "\u{2693}\u{FE0F}", name: "Anchor" },
  { emoji: "\u{1F3A7}", name: "Headphones" },
  { emoji: "\u{1F4C1}", name: "Folder" },
  { emoji: "\u{1F4CC}", name: "Pin" },
];

/**
 * Convert the leading bits of a hex SHA-256 pin to a fixed-length
 * emoji sequence.
 *
 * Input must be lowercase or uppercase hex; non-hex characters
 * are tolerated only insofar as `parseInt` handles them, which
 * for our inputs (always wire-form lowercase hex) is fine. An
 * empty string returns an empty array. If the input is shorter
 * than the bits needed for `count` emojis, the result is
 * truncated to whatever fits rather than padded; callers handle
 * the empty / partial case at render time.
 */
export function pinSha256ToEmojis(pin: string, count = 7): EmojiSlot[] {
  if (!pin) return [];
  const slots: EmojiSlot[] = [];
  let bits = 0;
  let bitsAvailable = 0;
  let hexIdx = 0;
  while (slots.length < count) {
    while (bitsAvailable < 6 && hexIdx < pin.length) {
      const nibble = parseInt(pin[hexIdx]!, 16);
      if (Number.isNaN(nibble)) {
        return slots;
      }
      bits = (bits << 4) | nibble;
      bitsAvailable += 4;
      hexIdx += 1;
    }
    if (bitsAvailable < 6) break;
    const idx = (bits >> (bitsAvailable - 6)) & 0x3f;
    bits &= (1 << (bitsAvailable - 6)) - 1;
    bitsAvailable -= 6;
    // Spread-copy the table entry so callers receive their own
    // `EmojiSlot` instance; the readonly modifier on the
    // interface gives a TypeScript-level guard, and this copy
    // is the runtime guard against rogue JS that ignores the
    // type system and mutates a slot in place.
    const slot = SAS_EMOJIS[idx]!;
    slots.push({ emoji: slot.emoji, name: slot.name });
  }
  return slots;
}
