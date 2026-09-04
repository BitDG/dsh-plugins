/** DSH-token-only styling for the reference-library card in Settings → Plugins. */
export const settingsCss = {
  card: 'dship-reference-settings-card',
  open: 'dship-reference-settings-card-open',
  header: 'dship-reference-settings-header',
  headCopy: 'dship-reference-settings-head-copy',
  title: 'dship-reference-settings-title',
  description: 'dship-reference-settings-description',
  pending: 'dship-reference-settings-pending',
  chevron: 'dship-reference-settings-chevron',
  body: 'dship-reference-settings-body',
  group: 'dship-reference-settings-group',
  groupTitle: 'dship-reference-settings-group-title',
  chrome: 'dship-reference-settings-chrome',
  chromeHead: 'dship-reference-settings-chrome-head',
  chromeCopy: 'dship-reference-settings-chrome-copy',
  status: 'dship-reference-settings-status',
  statusOff: 'dship-reference-settings-status-off',
  login: 'dship-reference-settings-login',
  disconnect: 'dship-reference-settings-disconnect',
  field: 'dship-reference-settings-field',
  fieldHead: 'dship-reference-settings-field-head',
  label: 'dship-reference-settings-label',
  hint: 'dship-reference-settings-hint',
  input: 'dship-reference-settings-input',
  invalidInput: 'dship-reference-settings-input-invalid',
  badges: 'dship-reference-settings-badges',
  badge: 'dship-reference-settings-badge',
  reset: 'dship-reference-settings-reset',
  pair: 'dship-reference-settings-pair',
  footer: 'dship-reference-settings-footer',
  message: 'dship-reference-settings-message',
  discard: 'dship-reference-settings-discard',
  save: 'dship-reference-settings-save',
} as const

export const settingsStylesheet = `
.dship-reference-settings-card {
  list-style: none;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
}
.dship-reference-settings-card-open {
  border-color: var(--dsw-alias-label-dimmed);
  background: var(--dsw-alias-bg-layer-2);
}
.dship-reference-settings-header {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.dship-reference-settings-header:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -2px;
}
.dship-reference-settings-head-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.dship-reference-settings-title { font-size: 15px; font-weight: 600; line-height: 21px; }
.dship-reference-settings-description { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }
.dship-reference-settings-pending,
.dship-reference-settings-badge,
.dship-reference-settings-status {
  border-radius: 999px;
  padding: 1px 8px;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  font-weight: 500;
  line-height: 17px;
  white-space: nowrap;
}
.dship-reference-settings-status-off { background: transparent; color: var(--dsw-alias-label-tertiary); }
.dship-reference-settings-chevron { color: var(--dsw-alias-label-tertiary); transition: transform .16s; }
.dship-reference-settings-card-open .dship-reference-settings-chevron { transform: rotate(180deg); }
.dship-reference-settings-body { margin: 0 16px; padding-bottom: 8px; border-top: 1px solid var(--dsw-alias-border-l2); }
.dship-reference-settings-group { padding: 14px 0 4px; }
.dship-reference-settings-group + .dship-reference-settings-group { border-top: 1px solid var(--dsw-alias-border-l2); }
.dship-reference-settings-group-title {
  margin: 0 0 4px;
  color: var(--dsw-alias-label-caption);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .04em;
  line-height: 17px;
  text-transform: uppercase;
}
.dship-reference-settings-chrome {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px 14px;
  margin: 8px 0 4px;
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
}
.dship-reference-settings-chrome-head { display: flex; align-items: center; gap: 8px; }
.dship-reference-settings-chrome-copy { min-width: 0; }
.dship-reference-settings-chrome > .dship-reference-settings-field { grid-column: 1 / -1; }
.dship-reference-settings-login,
.dship-reference-settings-disconnect,
.dship-reference-settings-discard,
.dship-reference-settings-save,
.dship-reference-settings-reset {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font: inherit;
  text-decoration: none;
}
.dship-reference-settings-login,
.dship-reference-settings-disconnect { align-self: center; padding: 5px 10px; font-size: 12px; line-height: 18px; }
.dship-reference-settings-login { grid-column: 1; justify-self: start; border-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-state-business-primary); }
.dship-reference-settings-disconnect { grid-column: 2; }
.dship-reference-settings-field { display: flex; flex-direction: column; gap: 6px; padding: 9px 0; }
.dship-reference-settings-field-head { display: flex; align-items: center; gap: 8px; }
.dship-reference-settings-label { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 20px; }
.dship-reference-settings-badges { display: inline-flex; align-items: center; gap: 8px; }
.dship-reference-settings-reset { padding: 0; border: 0; border-radius: 0; font-size: 12px; line-height: 18px; }
.dship-reference-settings-input {
  box-sizing: border-box;
  width: 100%;
  height: 34px;
  padding: 0 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
}
.dship-reference-settings-input:focus-visible { outline: none; border-color: var(--dsw-alias-brand-primary); }
.dship-reference-settings-input-invalid { border-color: var(--dsw-alias-state-error-primary); }
.dship-reference-settings-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.dship-reference-settings-hint { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dship-reference-settings-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.dship-reference-settings-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 0 4px;
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.dship-reference-settings-message { flex: 1; margin: 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.dship-reference-settings-discard,
.dship-reference-settings-save { padding: 5px 14px; font-size: 13px; line-height: 20px; }
.dship-reference-settings-save { border-color: transparent; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3); }
.dship-reference-settings-login:hover,
.dship-reference-settings-disconnect:hover:not(:disabled),
.dship-reference-settings-discard:hover:not(:disabled),
.dship-reference-settings-reset:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
.dship-reference-settings-save:disabled,
.dship-reference-settings-discard:disabled,
.dship-reference-settings-disconnect:disabled,
.dship-reference-settings-reset:disabled { cursor: default; opacity: .4; }
@media (max-width: 640px) {
  .dship-reference-settings-chrome { grid-template-columns: 1fr; }
  .dship-reference-settings-login,
  .dship-reference-settings-disconnect { grid-column: 1; justify-self: start; }
  .dship-reference-settings-pair { grid-template-columns: 1fr; gap: 0; }
}
`
