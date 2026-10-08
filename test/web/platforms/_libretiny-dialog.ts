import { expect, vi } from "vitest";

import { identityLocalize, mount } from "../../_dom.js";
import {
  type LibreTinyInstall,
  LibreTinyInstallDialog,
} from "../../../src/web/install/esphome-web-libretiny-install-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * What the LibreTiny install dialog's tests share. Each test file mocks
 * ``fetchEsphomeWebManifest`` itself (a ``vi.mock`` here would not be
 * hoisted into it) and resolves it with ``manifest(...)``.
 */

/** A manifest publishing an ESPHome Web image for each of ``families``. */
export const manifest = (...families: string[]) => ({
  version: "26.10.0",
  builds: families.map((chipFamily) => ({ chipFamily, parts: [] })),
});

/** Serves ``bytes`` for every UF2 download; returns the fetch to look at. */
export function stubUf2Download(bytes = new Uint8Array([1, 2, 3])) {
  const fetch = vi.fn(async (_url: string) => ({
    ok: true,
    arrayBuffer: async () => bytes.slice().buffer,
  }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** The open dialog for ``install``. */
export async function mountInstall(install: LibreTinyInstall<any>): Promise<any> {
  return (await mount(new LibreTinyInstallDialog(), {
    _localize: identityLocalize,
    open: true,
    install,
  } as Partial<LibreTinyInstallDialog>)) as any;
}

/**
 * The open dialog for ``install`` once it has read a manifest that
 * publishes ``families``, with the published image prepared where the
 * chip does not pick it.
 */
export async function mountPrebuilt(
  install: LibreTinyInstall<any>,
  fetchManifest: { mockResolvedValue: (value: unknown) => unknown },
  ...families: string[]
): Promise<any> {
  fetchManifest.mockResolvedValue(manifest(...families));
  const el = await mountInstall(install);
  await vi.waitFor(() => expect(el._setup.families).toEqual(families));
  await vi.waitFor(() => expect(el._setup.image.state.kind).not.toBe("pending"));
  await el.updateComplete;
  return el;
}

/**
 * Picks ``file`` and waits for it to be read and checked, as the dialog
 * does before it offers the install.
 */
export async function pickUf2(el: any, file: File | null): Promise<void> {
  el._setup.onFileChange({ target: { files: file ? [file] : [] } });
  await vi.waitFor(() => expect(el._setup.image.state.kind).not.toBe("pending"));
  await el.updateComplete;
}

export const radios = (el: any, name: string) =>
  [...el.shadowRoot!.querySelectorAll(`input[name=${name}]`)] as HTMLInputElement[];

export const installButton = (el: any) =>
  el.shadowRoot!.querySelector(".actions wa-button") as HTMLElement;

export const card = (el: any) =>
  el.shadowRoot!.querySelector("esphome-process-terminal") as any;

export const guide = (el: any) =>
  el.shadowRoot!.querySelector(".guide a") as HTMLAnchorElement;

export const uf2 = (name = "firmware.uf2") => new File([new Uint8Array(8)], name);
