import { css, html, nothing, type TemplateResult } from "lit";

import type { LocalizeFunc } from "../../common/localize.js";

import { renderFilePicker, renderFileStatus } from "./file-picker.js";
import type { InstallMode, LibreTinySetup } from "./libretiny-setup.js";

/**
 * The setup step: the family's intro and file picker where nothing is
 * published for it, else the choice between the published firmware and the
 * user's own UF2.
 */
export function renderSetup(
  setup: LibreTinySetup,
  localize: LocalizeFunc,
  intro: string
): TemplateResult {
  const file = renderFile(setup, localize);
  if (!setup.families.length)
    return html`<p>${localize(intro)}</p>
      ${file}`;
  return html`
    ${renderRadios({
      name: "mode",
      legend: localize("web.install.mode_label"),
      options: [
        ["prebuilt", localize("web.install.mode_prebuilt")],
        ["file", localize("web.install.mode_file")],
      ],
      value: setup.mode,
      onChange: (mode) => setup.setMode(mode as InstallMode),
    })}
    ${
      setup.prebuilt
        ? renderPrebuilt(setup, localize)
        : html`<p>${localize("web.install.uf2_intro")}</p>
            ${file}`
    }
  `;
}

const preparing = (setup: LibreTinySetup, localize: LocalizeFunc) =>
  setup.image.state.kind === "pending" ? localize("web.install.preparing") : undefined;

// A chip picker where the chip does not tell the family and several are published.
function renderPrebuilt(setup: LibreTinySetup, localize: LocalizeFunc): TemplateResult {
  return html`
    <p>${localize("web.install.prebuilt_intro")}</p>
    ${
      !setup.linked && setup.families.length > 1
        ? renderRadios({
            name: "family",
            legend: localize("web.install.prebuilt_chip_label"),
            options: setup.families.map((family) => [family, family] as const),
            value: setup.family,
            onChange: (family) => setup.setMode("prebuilt", family),
          })
        : nothing
    }
    <div class="file-row">
      ${renderFileStatus(preparing(setup, localize), setup.error)}
    </div>
  `;
}

function renderFile(setup: LibreTinySetup, localize: LocalizeFunc): TemplateResult {
  return html`
    ${renderFilePicker({
      label: localize("web.install.uf2_file_label"),
      accept: ".uf2",
      file: setup.file,
      placeholder: localize("web.install.uf2_file_placeholder"),
      onChange: setup.onFileChange,
      preparing: preparing(setup, localize),
      error: setup.error,
    })}
    <p>${localize("web.install.uf2_howto_title")}</p>
    <ol>
      <li>${localize("web.install.upload_howto_1")}</li>
      <li>${localize("web.install.upload_howto_2")}</li>
      <li>${localize("web.install.uf2_howto_3")}</li>
    </ol>
  `;
}

/** The failure line for a linked chip without a published image; ``chip`` is absent when it could not be told. */
export const unpublishedChipLine = (localize: LocalizeFunc, chip: string | undefined) =>
  chip
    ? localize("web.install.prebuilt_no_image", { chip })
    : localize("web.install.prebuilt_unknown_chip");

/** A labelled set of radio buttons, one per ``[value, label]``. */
function renderRadios(radios: {
  name: string;
  legend: string;
  options: readonly (readonly [string, string])[];
  value: string;
  onChange: (value: string) => void;
}): TemplateResult {
  return html`
    <fieldset class="radios">
      <legend>${radios.legend}</legend>
      ${radios.options.map(
        ([value, label]) => html`
          <label>
            <input
              type="radio"
              name=${radios.name}
              value=${value}
              .checked=${value === radios.value}
              @change=${() => radios.onChange(value)}
            />
            ${label}
          </label>
        `
      )}
    </fieldset>
  `;
}

export const setupStyles = css`
  ol {
    padding-left: 1.5em;
    color: var(--wa-color-text-quiet);
  }
  .radios {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
    margin: 0 0 var(--wa-space-m);
    padding: 0;
    border: none;
  }
  .radios legend {
    padding: 0;
    margin-bottom: var(--wa-space-2xs);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }
  .radios label {
    display: flex;
    align-items: center;
    gap: var(--wa-space-xs);
  }
`;
