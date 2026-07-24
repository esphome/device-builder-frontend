# ESPHome Web development

The standalone, backend-free Web Serial tool published to
[web.esphome.io](https://web.esphome.io). Everything runs in the
browser: connect an ESP or Raspberry Pi Pico W over USB to install
firmware, stream logs, and provision Wi-Fi via Improv. It shares the
repo's `src/` tree (design system, the esptool-js flash engine in
`src/util/web-serial.ts`, localization) and adds only this app.

## Dev server

```bash
corepack pnpm install
corepack pnpm run dev:web
```

HMR dev server on `http://localhost:5174` — no backend needed. Pass
`PORT=<n>` to run on a different port when 5174 is taken
(`build-scripts/dev-web-server.cjs` honors it).

Web Serial needs a secure context and a supporting browser: any
Chromium-based browser, or Firefox 151+. `localhost` counts as secure,
so the dev server works as-is; testing from another machine needs
https. Safari has no Web Serial and renders the unsupported card.

## Testing with hardware

Plug a device in and use the site like a user would. The interesting
hardware classes behave differently:

- **Native-USB chips** (ESP32-C3 / S3 / C6, USB-Serial/JTAG): drop off
  the bus and re-enumerate after plug-in, reset, or flash. The connect
  cards and the logs terminal ride these blips out via
  `reacquirePort`; Chrome hands back a fresh handle, Firefox keeps the
  same one — test both.
- **UART bridges** (CP210x, CH34x): no re-enumeration; DTR/RTS reset
  pulses work.
- **Pico W**: native-USB CDC; no DTR/RTS reset, and flashing goes
  through UF2 (its own connect card and install dialog).

## Where things live

| Path | What |
|---|---|
| `entrypoint.ts` / `esphome-web-app.ts` | App shell |
| `dashboard/` | Connect cards (ESP + Pico) and per-device action cards |
| `install/` | Flash dialogs and the install flow controller |
| `logs/` | Serial log viewer dialog |
| `improv/` | Wi-Fi provisioning dialog |
| `flash-receiver/` | Receives images from a Device Builder over the local network |
| `util/` | Web-only helpers (port disconnect watcher, firmware fetch, Pico filter) |

New copy goes in `src/translations/en.json` under the `web.*`
namespace. Tests live in `test/web/` and run with the main suite
(`corepack pnpm test`); lint with `corepack pnpm run lint`.

## Build and deploy

```bash
corepack pnpm run build:web   # static site → esphome_web/ (gitignored)
```

The output is never part of the wheel;
`.github/workflows/deploy-web.yml` publishes it to GitHub Pages.
