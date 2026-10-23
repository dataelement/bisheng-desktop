/** Presentation-only overrides for the isolated desktop Chat document.
 * These owned BISHENG markers are not Harness Work tabs. Remove this adapter
 * when the embedded page ships a single-row header itself.
 */
export const CHAT_LAYOUT_CSS = `
.dsh-chat-surface .dsh-chat-header .dsh-chat-section-row { display: none !important; }
.dsh-chat-surface .dsh-chat-header {
  grid-template-rows: 30px !important;
  row-gap: 0 !important;
  height: 48px !important;
  padding-top: 9px !important;
  padding-bottom: 9px !important;
}
`
