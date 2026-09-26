# ESPHome Web development

The standalone, backend-free Web Serial tool published to
[web.esphome.io](https://web.esphome.io). Everything runs in the
browser: connect an ESP or Raspberry Pi Pico W over USB to install
firmware, stream logs, and provision Wi-Fi via Improv; an nRF52 gets DFU
installs and logs over USB or Bluetooth; an RTL8720C gets a LibreTiny UF2
flashed through its ROM downloader and logs over its serial adapter. It shares the
repo's `src/` tree (design system, the esptool-js flash engine in
`src/platforms/esp/esptool.ts`, localization) and adds only this app.

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
- **RTL8720C kits** (BW15 and the like, behind a CH340): RTS drives CEN
  and DTR drives the PA00 download strap, so a plain open (Chromium
  asserts both lines) holds the chip in reset. Every logs open releases
  both lines right away (`RTL87XX_SERIAL_LOGS` in `src/platforms/rtl87xx/serial-logs.ts`); the install
  dialog's engine drives them itself and falls back to the manual strap.
- **Pico W**: native-USB CDC; a DTR/RTS pulse does nothing, so the logs
  dialog's Reset Device instead touches the port at 1200 baud into
  BOOTSEL and reboots it over WebUSB (`RP2_SERIAL_LOGS` in
  `src/platforms/rp2/serial-logs.ts`, shared with the Device Builder),
  after which the CDC port re-enumerates; without WebUSB the button is
  hidden. Flashing goes through UF2 (its own connect card and install
  dialog).

## Where things live

| Path                                   | What                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `entrypoint.ts` / `esphome-web-app.ts` | App shell                                                                                       |
| `web-mode.ts`, `header/`               | The mode switch (ESP, `?pico`, `?nrf`, `?rtl`) and the header, both read from the registry      |
| `dashboard/`                           | The dashboard, the shared card shell and the unsupported-browser card                           |
| `platforms/<name>/`                    | Each family's `mode.ts`, cards and install dialogs; `platforms/registry.ts` lists them          |
| `install/`                             | Pieces the install dialogs share: the progress card and the file picker                         |
| `logs/`                                | Log viewer dialog and its sources (Web Serial, Bluetooth for nRF52)                             |
| `improv/`                              | Wi-Fi provisioning dialog                                                                       |
| `flash-receiver/`                      | Flashes firmware a Device Builder hands over when it can't flash itself                         |
| `util/`                                | Web-only helpers (firmware fetch, port pickers and release, disconnect watcher)                 |

### Adding a device family

A family is a directory under `platforms/` with a `mode.ts` exporting its
`WebPlatform` (`platforms/web-platform.ts`): its mode flag, header logo and
label, intro copy, connect card, and the USB ids that claim a port for the
flow switch toast, with its copy. Add it to `WEB_PLATFORMS` in
`platforms/registry.ts`, put its logo in `public/web/static/logo/`, and its
copy in `en.json`. The header, the dashboard, the mode URL and the flow switch
need no edits. Its logs card passes the platform's `SerialLogsPolicy` (from
`src/platforms/serial-logs.ts`, shared with the Device Builder: its Reset device
and which lines an open or a reopen leaves up) to both the port open and the
logs dialog's `policy`; the dialog's default is no reset.

New copy goes in `src/translations/en.json` under the `web.*`
namespace. Tests live in `test/web/` (platform tests in
`test/web/platforms/<name>/`) and run with the main suite
(`corepack pnpm test`); lint with `corepack pnpm run lint`.

## Build and deploy

```bash
corepack pnpm run build:web   # static site → esphome_web/ (gitignored)
```

The output is never part of the wheel;
`.github/workflows/deploy-web.yml` publishes it to GitHub Pages.
