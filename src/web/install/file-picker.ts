import { css, html, type TemplateResult } from "lit";

/** The file row the file-driven install dialogs share: a labelled input plus the picked name. */
export function renderFilePicker(picker: {
  label: string;
  accept: string;
  file: File | null;
  placeholder: string;
  onChange: (e: Event) => void;
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
  .file-name {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;
