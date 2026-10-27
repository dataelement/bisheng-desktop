/** Desktop window chrome for the isolated Chat document, using owned BISHENG markers.
 * The embedded WebContentsView declares its own native drag region.
 */
export const CHAT_LAYOUT_CSS = `
.dsh-chat-surface .dsh-chat-header .dsh-chat-section-row { display: none !important; }
.dsh-chat-surface .dsh-chat-header {
  grid-template-rows: 30px !important;
  row-gap: 0 !important;
  height: 48px !important;
  padding-top: 9px !important;
  padding-bottom: 9px !important;
  -webkit-app-region: drag;
  user-select: none;
}
/* Interactive controls retain pointer input inside the native title bar. */
.dsh-chat-surface .dsh-chat-header :is(button, a[href], input, textarea, select, [role="button"], [role="link"], [tabindex], [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]) {
  -webkit-app-region: no-drag;
}
`
