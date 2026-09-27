import { css, html, nothing, type TemplateResult } from "lit";

/** Why a picked file cannot be installed. */
export interface FilePickerError {
  title: string;
  detail: string;
}

/**
 * The file row the file-driven install dialogs share: a labelled input, the
 * picked name, and what is happening to the file (being prepared, refused).
 */
export function renderFilePicker(picker: {
  label: string;
  accept: string;
  file: File | null;
  placeholder: string;
  onChange: (e: Event) => void;
  /** The line to show while the picked file is read and checked. */
  preparing?: string;
  error?: FilePickerError | null;
}): TemplateResult {
  return html`
    <div class="file-row">
      <label class="file-label">
        <span>${picker.label}</span>
        <input type="file" accept=${picker.accept} @change=${picker.onChange} />
      </label>
      <span class="file-name"
        >${picker.file ? picker.file.name : picker.placeholder}</span
      >
      ${
        picker.preparing
          ? html`<span class="file-status" role="status">${picker.preparing}</span>`
          : nothing
      }
      ${
        picker.error
          ? html`<span class="file-status file-status--error" role="alert"
              >${picker.error.title}${picker.error.detail ? `: ${picker.error.detail}` : ""}</span
            >`
          : nothing
      }
    </div>
  `;
}

export const filePickerStyles = css`
  .file-row {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
  }
  .file-label {
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-2xs);
    font-size: var(--wa-font-size-s);
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }
  .file-label input[type="file"] {
    font-size: var(--wa-font-size-s);
    font-family: inherit;
  }
  .file-status {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
  }
  .file-status--error {
    color: var(--esphome-error);
  }
  .file-name {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;
