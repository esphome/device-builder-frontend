/**
 * @vitest-environment happy-dom
 *
 * Audit for issue #1670: every non-destructive submit dialog/step wired for
 * Enter fires its primary action on a plain Enter while active, and stays inert
 * while closed/inactive. Destructive or fleet-wide confirms (overwrite-device,
 * resolve-conflicts, update-all) intentionally remain click-only and are not
 * listed here. A new submit dialog should be added to `cases` below; a dialog
 * that forgets its Enter wiring fails this suite, which is the issue's
 * "is there a way to identify them in the code?" answer.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import "../_mock-webawesome.js";

import type { LitElement } from "lit";
import { ESPHomeBulkLabelsDialog } from "../../src/components/labels/bulk-labels-dialog.js";
import { ESPHomePairBuildServerDialog } from "../../src/components/pair-build-server-dialog.js";
import { ESPHomeWizardStepImportPartial } from "../../src/components/wizard/wizard-step-import-partial.js";
import { pressEnter } from "../_press-enter.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface EnterCase {
  name: string;
  /** Handler property replaced with a spy; what Enter must invoke. */
  primary: string;
  mount: () => LitElement;
  /** Put the host into its submittable + active state. */
  activate: (host: any) => Promise<void>;
}

const cases: EnterCase[] = [
  {
    name: "bulk-labels apply",
    primary: "_apply",
    mount: () => new ESPHomeBulkLabelsDialog(),
    activate: async (host) => {
      // Apply is gated on pending changes; force the derived getter true so the
      // dialog wires confirmOnEnter without staging real per-device edits.
      Object.defineProperty(host, "_hasPendingChanges", {
        configurable: true,
        get: () => true,
      });
      host._saving = false;
      host.open();
      host.requestUpdate();
      await host.updateComplete;
    },
  },
  {
    name: "pair-build-server preview (input step)",
    primary: "_onPreviewSubmit",
    mount: () => new ESPHomePairBuildServerDialog(),
    activate: async (host) => {
      host.open({ hostname: "server.local" });
      await host.updateComplete;
    },
  },
  {
    name: "pair-build-server confirm step",
    primary: "_onConfirmSubmit",
    mount: () => new ESPHomePairBuildServerDialog(),
    activate: async (host) => {
      host.open({ hostname: "server.local" });
      host._step = "confirm";
      host.requestUpdate();
      await host.updateComplete;
    },
  },
  {
    name: "wizard-step import-partial open",
    primary: "_open",
    mount: () => new ESPHomeWizardStepImportPartial(),
    activate: async (host) => {
      host.active = true;
      await host.updateComplete;
    },
  },
];

afterEach(() => {
  vi.clearAllMocks();
});

describe.each(cases)(
  "$name Enter-to-submit (issue #1670)",
  ({ primary, mount, activate }) => {
    it("invokes the primary action on Enter while active", async () => {
      const host = mount() as any;
      const spy = vi.fn();
      host[primary] = spy;
      document.body.appendChild(host);
      await host.updateComplete;
      await activate(host);
      pressEnter();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("does nothing on Enter while closed/inactive", async () => {
      const host = mount() as any;
      const spy = vi.fn();
      host[primary] = spy;
      document.body.appendChild(host);
      await host.updateComplete;
      pressEnter();
      expect(spy).not.toHaveBeenCalled();
    });
  }
);

// A held Enter must not carry from the input step into the confirm submit: the
// dialog stays open across input→confirm, so a missing repeat guard would send
// the pair request past the unreviewed pin fingerprint.
it("pair-build-server ignores a held (repeat) Enter on the input step", async () => {
  const host = new ESPHomePairBuildServerDialog() as any;
  const preview = vi.fn();
  host._onPreviewSubmit = preview;
  document.body.appendChild(host);
  await host.updateComplete;
  host.open({ hostname: "server.local" });
  await host.updateComplete;
  pressEnter({ repeat: true });
  expect(preview).not.toHaveBeenCalled();
});
