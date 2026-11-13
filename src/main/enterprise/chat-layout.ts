// The searchable Cascader puts the combobox role on its input; the compact one puts it on the shell.
export const CHAT_MODEL_TRIGGER = '.dsh-composer-trailing > [data-state]:is([role="combobox"], :has(input[role="combobox"]))'
const DESKTOP_MODEL_TRIGGER = `:root[data-bisheng-surface="desktop"] .dsh-chat-surface .dsh-composer-toolbar ${CHAT_MODEL_TRIGGER}`

/** Shared content layout for the isolated enterprise document. */
export const CHAT_LAYOUT_CSS = `
/* The cached Apps panel sits inside auto-height KeepAlive wrappers.
   Use the desktop seat height so a short list cannot expose the backing. */
html[data-dsh-chat-viewport][data-dsh-page="apps"] .dsh-web-chat [data-workbench-panel] {
  height: var(--dsh-chat-viewport-height);
  max-height: var(--dsh-chat-viewport-height);
}

.dsh-chat-surface .dsh-chat-header .dsh-chat-section-row { display: none !important; }
.dsh-chat-surface .dsh-chat-header {
  grid-template-rows: 30px !important;
  row-gap: 0 !important;
  height: 48px !important;
  padding-top: 9px !important;
  padding-bottom: 9px !important;
  user-select: none;
}
/* Interactive controls retain pointer input inside the native title bar. */
.dsh-chat-surface .dsh-chat-header :is(button, a[href], input, textarea, select, [role="button"], [role="link"], [tabindex], [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]) {
  -webkit-app-region: no-drag;
}

/* Match the native Work model trigger while retaining the web Cascader's search and focus handling. */
${DESKTOP_MODEL_TRIGGER} {
  box-sizing: border-box;
  height: 28px;
  min-height: 28px;
  max-width: min(360px, 45cqw);
  gap: 4px;
  padding: 0 4px 0 8px;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, rgb(var(--text-2)));
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
}
${DESKTOP_MODEL_TRIGGER} input[role="combobox"] { font: inherit; }
${DESKTOP_MODEL_TRIGGER} > :last-child {
  color: var(--dsw-alias-label-caption, rgb(var(--text-3)));
}
${DESKTOP_MODEL_TRIGGER} > :last-child > svg {
  width: 16px;
  height: 16px;
  transition-duration: 120ms;
}
${DESKTOP_MODEL_TRIGGER}:hover:not([aria-disabled="true"], :has(input:disabled)) {
  background: var(--dsw-alias-interactive-bg-hover, rgb(var(--fill-2)));
}
${DESKTOP_MODEL_TRIGGER}:is(:focus-visible, :has(input:focus-visible)) {
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, rgb(var(--brand-500))));
}
${DESKTOP_MODEL_TRIGGER}:is([aria-disabled="true"], :has(input:disabled)) {
  color: var(--dsw-alias-label-dimmed, rgb(var(--text-3)));
}
`

/** Windows owns dragging in its separate caption row; macOS uses the Chat header. */
export function chatLayoutCss(platform: NodeJS.Platform): string {
  return platform === 'darwin'
    ? `${CHAT_LAYOUT_CSS}\n.dsh-chat-surface .dsh-chat-header { -webkit-app-region: drag; }`
    : CHAT_LAYOUT_CSS
}
