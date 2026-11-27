import brandMark from '../../../build/bisheng-logo-mark.svg?raw'

// The shell shares this trusted markup between About, update dialogs and notices.
// Keep the enterprise substitution in the build rather than changing upstream UI.
export default `${brandMark}
<style>
  .app-icon { padding:0; background:transparent; }
  .app-icon svg path { fill:white; }
</style>`
