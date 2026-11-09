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
`

/** Windows owns dragging in its separate caption row; macOS uses the Chat header. */
export function chatLayoutCss(platform: NodeJS.Platform): string {
  return platform === 'darwin'
    ? `${CHAT_LAYOUT_CSS}\n.dsh-chat-surface .dsh-chat-header { -webkit-app-region: drag; }`
    : CHAT_LAYOUT_CSS
}
