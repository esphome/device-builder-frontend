import { Router } from "@lit-labs/router";
import { html, type ReactiveControllerHost } from "lit";
import { withBase } from "../../util/base-path.js";

// Decode the :id path param, falling back to the raw value on URIError so a
// malformed % sequence doesn't crash the whole router — the device page's
// "not found" empty state is the right UX for a broken URL.
function decodeIdParam(id: string | undefined): string {
  if (!id) return "";
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export function createRouter(host: ReactiveControllerHost & HTMLElement): Router {
  return new Router(host, [
    {
      path: withBase("/"),
      render: () => html`<esphome-page-dashboard></esphome-page-dashboard>`,
    },
    {
      path: withBase("/secrets"),
      enter: async () => {
        await import("../../pages/secrets.js");
        return true;
      },
      render: () => html`<esphome-page-secrets></esphome-page-secrets>`,
    },
    {
      path: withBase("/device/:id"),
      enter: async () => {
        await import("../../pages/device.js");
        return true;
      },
      render: ({ id }) =>
        html`<esphome-page-device .id=${decodeIdParam(id)}></esphome-page-device>`,
    },
  ]);
}
