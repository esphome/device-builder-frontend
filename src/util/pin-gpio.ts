/*
 * Pin string <-> GPIO number primitives, shared by the pin-selector
 * renderer (current value + suggestions) and the YAML used-pin scanner
 * (cross-section conflict detection). They live here, free of any Lit /
 * DOM dependency, so both consumers agree on exactly one set of
 * platform pin-format rules — a single source of truth, so the picker
 * and the conflict scanner can't drift apart on what "P23" or "PA02"
 * means.
 *
 * Pin forms across the platforms ESPHome supports:
 *   - esp / esp8266 / rp2040          : bare int or "GPIOn"
 *   - bk72xx (LibreTiny / Beken)      : bare "P{n}" (e.g. "P23"), n is the pin
 *   - rtl87xx (LibreTiny / Realtek)   : "PA{n}" (e.g. "PA02"); rtl87xx is
 *                                        single-port, so n is the GPIO directly
 *   - ln882x (LibreTiny / Lightning)  : "PA{n}" (port A, n is the GPIO) and
 *                                        "PB{n}" (port B = GPIO 16+n, e.g.
 *                                        "PB03" -> 19; see LN882X_PORT_B_OFFSET)
 *   - nRF52                           : "P{port}.{pin}" = port*32 + pin
 *
 * ESPHome's LibreTiny validator (`_translate_pin`) also accepts "GPIOn"
 * for bk72xx / rtl87xx / ln882x — it strips the prefix to the numeric pin
 * and looks it up — so the board manifest labels those pins "GPIO{n}" and
 * `formatPinValue` writes the "GPIOn" form for rtl87xx / ln882x. bk72xx
 * keeps the bare "P{n}" form it's conventionally written in; nRF52's
 * validator rejects "GPIOn" outright and needs the port.pin form.
 *
 * Every form is globally unambiguous, so parsing doesn't need the platform:
 * bare "P{n}" is bk72xx only, "PA{n}" is port A (rtl87xx + ln882x, same
 * trailing -> GPIO rule), "PB{n}" is ln882x only, "P{port}.{pin}" is nRF52 only.
 * That's why the platform key in the YAML (mandatory — a platformless config
 * is invalid) doesn't need to be threaded in here.
 */

// ln882x splits its GPIOs into two ports of 16: port A is GPIO 0-15, port B is
// GPIO 16-31, so "PB{n}" resolves to 16 + n (verified constant across every
// ln882x board's pin map; no other platform uses a "PB" form).
const LN882X_PORT_B_OFFSET = 16;

// Bare int / "GPIOn" form (esp / esp8266 / rp2040 / ln882x / libretiny GPIO).
const GPIO_PIN_RE = /^\s*(?:GPIO)?(\d+)\s*$/i;
// nRF52 "P{port}.{pin}" form.
const NRF52_PIN_RE = /^\s*P(\d+)\.(\d+)\s*$/i;
// BK72xx (LibreTiny / Beken) "P{n}" form — bare P + number, no dot.
const BK72XX_PIN_RE = /^\s*P(\d+)\s*$/i;
// LibreTiny port-A "PA{n}" form (rtl87xx, ln882x). Port A maps trailing-number
// -> GPIO on every family ("PA02" -> 2, padding cosmetic).
const PORT_A_PIN_RE = /^\s*PA(\d+)\s*$/i;
// LibreTiny port-B "PB{n}" form (ln882x only) -> 16 + n.
const PORT_B_PIN_RE = /^\s*PB(\d+)\s*$/i;

/**
 * Parse a pin reference into a GPIO number. Used both for the field's
 * current value and for individual `suggestions` entries. Featured
 * manifests write pins as bare ints (`12`), string forms (`"GPIO12"`,
 * `"gpio12"`), nRF52 port.pin notation (`"P0.27"`, `"P1.1"`), LibreTiny
 * forms (`"P23"` bk72xx, `"PA02"` rtl87xx), or — for fields whose locked
 * preset needs the long-form ESPHome pin block — an object like
 * `{ number: 0, mode: { input: true, pullup: true }, inverted: true }`
 * (Sonoff Basic's front-panel button is the canonical example: the pin
 * is occupied + inverted + needs the internal pull-up, all baked into
 * the preset). Returns `null` for anything we can't parse — the caller
 * drops those entries rather than letting a typo blank the dropdown.
 */
export function parsePinGpio(s: unknown): number | null {
  if (typeof s === "number" && Number.isFinite(s)) return s;
  if (typeof s === "string") {
    const m = s.match(GPIO_PIN_RE);
    if (m) return Number(m[1]);
    // nRF52 port.pin notation, e.g. "P0.27" -> 27, "P1.1" -> 33. Each port has
    // 32 pins, so reject pin >= 32 ("P0.33") rather than normalize it to a
    // different valid-looking pin (which would silently rewrite the YAML).
    const p = s.match(NRF52_PIN_RE);
    if (p && Number(p[2]) < 32) return Number(p[1]) * 32 + Number(p[2]);
    // LibreTiny port-A "PA{n}" form (rtl87xx / ln882x; e.g. "PA02" -> 2) and
    // port-B "PB{n}" form (ln882x; e.g. "PB03" -> 19). Tried before the bare-P
    // bk72xx pattern since the leading "PA"/"PB" letter would otherwise fail it.
    const portA = s.match(PORT_A_PIN_RE);
    if (portA) return Number(portA[1]);
    const portB = s.match(PORT_B_PIN_RE);
    if (portB) return LN882X_PORT_B_OFFSET + Number(portB[1]);
    // BK72xx "P{n}" form (e.g. "P23" -> 23). Tried after the nRF52 and port
    // matches so the dotted "P0.27" and letter-port "PA02"/"PB03" forms are
    // never swallowed by this no-dot, no-letter pattern.
    const bk = s.match(BK72XX_PIN_RE);
    if (bk) return Number(bk[1]);
  }
  if (s !== null && typeof s === "object" && !Array.isArray(s)) {
    return parsePinGpio((s as Record<string, unknown>).number);
  }
  return null;
}

/**
 * Format a GPIO number as the pin value ESPHome's platform validator
 * accepts. "GPIOn" is the default — taken by esp / esp8266 / rp2040 /
 * rtl87xx / ln882x (their validators all accept it). Two exceptions:
 * nRF52's validator rejects "GPIOn" and wants port.pin notation ("P0.27",
 * "P1.1") — port*32 + pin; BK72xx writes the bare "P{n}" form ("P23"), the
 * convention its configs use, where the LibreTiny pin index is the number.
 */
export function formatPinValue(gpio: number, platform: string | undefined): string {
  if (platform === "nrf52") return `P${Math.floor(gpio / 32)}.${gpio % 32}`;
  if (platform === "bk72xx") return `P${gpio}`;
  return `GPIO${gpio}`;
}

// "GPIOn" anywhere in a line. The "GPIO" prefix is distinctive enough to scan
// unbounded (its own tokens can't collide with ordinary words).
const GPIO_TOKEN_RE = /GPIO(\d+)/gi;
// The LibreTiny / nRF52 "P…" pin forms anywhere in a line: port-A "PA{n}",
// port-B "PB{n}", nRF52 "P{port}.{pin}", bk72xx "P{n}". `\b` word boundaries
// keep a bare "P5" from matching inside words like "STEP5" / "PUMP5" /
// "relay_p7" — and from matching the "P" inside "GPIO5", "esp32", or "RP2040".
// The dotted nRF52 alternative is listed before the bare one so "P0.27" reads
// as 27, not 0.
const P_PIN_TOKEN_RE = /\bP(?:A(\d+)|B(\d+)|(\d+)\.(\d+)|(\d+))\b/gi;

/**
 * Every GPIO number referenced by *line*, across all pin string forms
 * (GPIOn / P{n} / PA{n} / PB{n} / P{port}.{pin}). Used by the YAML used-pin
 * scan so cross-section conflict warnings fire for LibreTiny and nRF52
 * configs, not just ESP "GPIOn" ones. Each form is unique to one platform (or
 * platforms that share its numbering), so scanning every form on one pass
 * can't cross-wire pins between platforms.
 */
export function scanPinGpios(line: string): number[] {
  const out: number[] = [];
  for (const m of line.matchAll(GPIO_TOKEN_RE)) out.push(Number(m[1]));
  for (const m of line.matchAll(P_PIN_TOKEN_RE)) {
    if (m[1] !== undefined) {
      out.push(Number(m[1])); // port-A "PA{n}" (rtl87xx / ln882x)
    } else if (m[2] !== undefined) {
      out.push(LN882X_PORT_B_OFFSET + Number(m[2])); // port-B "PB{n}" (ln882x)
    } else if (m[3] !== undefined && m[4] !== undefined) {
      // nRF52 "P{port}.{pin}" — reject pin >= 32 (mirrors parsePinGpio).
      const pin = Number(m[4]);
      if (pin < 32) out.push(Number(m[3]) * 32 + pin);
    } else if (m[5] !== undefined) {
      out.push(Number(m[5])); // bk72xx "P{n}"
    }
  }
  return out;
}

// ESPHome's `_pin`/`_gpio` suffix convention (mirrors `board-pin-defaults.ts`'s
// role strip) plus the long-form `pin:` / `number:` sub-keys.
const PIN_FIELD_KEY_RE = /(?:^|_)(?:pin|gpio)$|^number$/i;

/**
 * Whether a mapping key names a pin field. Lets the used-pin scan accept a
 * bare-integer value (`tx_pin: 1`) that {@link scanPinGpios} can't see — the
 * token forms it matches all carry a distinctive prefix, a bare int doesn't.
 */
export function isPinFieldKey(key: string): boolean {
  return PIN_FIELD_KEY_RE.test(key);
}
