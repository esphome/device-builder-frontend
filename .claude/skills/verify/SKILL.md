---
name: verify
description: Run the device-builder dev stack and drive the dashboard headlessly to verify frontend changes at the rendered surface
---

# Verifying frontend changes end-to-end

## Stack

- Backend (editable checkout at `/Users/bdraco/device-builder_4`; its
  `.venv` works, system python3 does not):
  `.venv/bin/esphome-device-builder <config-dir> --dev --host 127.0.0.1 --port 6152`
  The config dir just needs a device yaml (esphome+esp32+api+logger is
  enough). Port 6052 is often occupied by the user's own stack — don't
  kill it; pick another port.
- Frontend dev server from this repo:
  `PORT=5199 BACKEND_PORT=6152 npm run dev`
  (`BACKEND_PORT` is honored by `build-scripts/rspack.cjs`; the proxy
  covers `/ws` and HTTP.)

## Driving the UI headlessly

Claude-in-Chrome may be unavailable; `npm install puppeteer-core` in the
scratchpad and launch the system Chrome
(`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
`headless: "new"`).

- Components live behind nested shadow roots; find them with a
  recursive walker over `node.shadowRoot?.children ?? []` plus
  `node.children`.
- Dialogs (rename/clone/friendly-name, etc.) are mounted by
  `dashboard/render-dialogs.ts` and expose imperative `open(...)`
  methods — call them via `page.evaluate` instead of navigating menus.
- **Focus the shadow-DOM input via evaluate before `page.keyboard.type`**
  — keyboard input silently goes nowhere otherwise (screenshot to
  confirm text landed).
- For "renders identically" claims: capture `getComputedStyle` for the
  affected selectors + screenshots, `git stash -u`, wait ~4s for the
  rspack rebuild, capture again, diff the JSON, `git stash pop`.
- Rename-dialog probes: an invalid name (`Living Room!`) renders
  `.field-error`; a valid-but-warned name (`living_room`) renders
  `.field-warning`.
