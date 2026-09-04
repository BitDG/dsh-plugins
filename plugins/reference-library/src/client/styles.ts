/** Stable global class names for the plugin-owned composer prompt. */
export const css = {
  prompt: 'dship-reference-library-prompt',
  copy: 'dship-reference-library-copy',
  title: 'dship-reference-library-title',
  body: 'dship-reference-library-body',
  url: 'dship-reference-library-url',
  actions: 'dship-reference-library-actions',
  button: 'dship-reference-library-button',
  primary: 'dship-reference-library-primary',
  error: 'dship-reference-library-error',
} as const

/** Styles travel inside the dynamic client bundle and are installed with its Cordis lifecycle. */
export const stylesheet = `
.dship-reference-library-prompt {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px 14px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-shadow-lv1);
}

.dship-reference-library-copy { min-width: 0; }

.dship-reference-library-title {
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}

.dship-reference-library-body {
  margin-top: 1px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 18px;
}

.dship-reference-library-url {
  display: block;
  max-width: 100%;
  overflow: hidden;
  color: var(--dsw-alias-state-business-primary);
  font-family: ui-monospace, 'Cascadia Code', 'SFMono-Regular', Consolas, monospace;
  font-size: 11px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dship-reference-library-actions { display: flex; gap: 6px; }

.dship-reference-library-button {
  min-height: 30px;
  padding: 4px 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
}

.dship-reference-library-button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

.dship-reference-library-primary {
  border-color: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-state-business-primary);
}

.dship-reference-library-button:disabled { cursor: wait; opacity: 0.6; }

.dship-reference-library-error {
  grid-column: 1 / -1;
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 18px;
}

@media (max-width: 640px) {
  .dship-reference-library-prompt { grid-template-columns: 1fr; }
  .dship-reference-library-actions { justify-content: flex-end; }
}
`
