// Explicitly reviewed public files carried by the downstream product branch.
// The blob ids make this an exact allowlist. Any local edit requires a new
// review entry instead of silently weakening the upstream boundary gate.
export const PUBLIC_OVERRIDES = [
  { file: 'cordis.yml', oid: '85a037023111579a8c3f0ec80ef720ba52f5f776', reason: 'enterprise runtime composition' },
  { file: 'docs/desktop-deep-links.md', oid: '28d640560366021e4b2f1cca57eb42bc4e114392', reason: 'downstream deep-link contract' },
  { file: 'docs/desktop-product-identity.md', oid: 'd0764cc748db650fca5e3bab674a88f69230c7c9', reason: 'upstream candidate: configurable product deep-link protocol documentation' },
  { file: 'docs/enterprise-workbench-offline-install.md', oid: '6398c7ad1b65465b4817a26985b52da765b2b7ad', reason: 'enterprise workbench install guide' },
  { file: 'packages/dsh-desktop-client-ui/client.js', oid: 'e2ddeb3689f05a49f3869cc2c935468f78c42c45', reason: 'downstream client UI extension points and Office template controls' },
  { file: 'packages/dsh-desktop-workbenches/client.js', oid: 'aef4e08bb855ec12fe0d7eadc75214d039e14ceb', reason: 'downstream workbench UI integration' },
  { file: 'src/main/shell/deep-links.ts', oid: '773bac89cc2bb952c2c7098fb2d5ec77eca3d12b', reason: 'enterprise deep-link routing' },
  { file: 'src/main/shell/product-identity.ts', oid: 'cb05239f6d749634d4be2fb74e2a99debdc0cc45', reason: 'upstream candidate: configurable product deep-link protocol scheme' },
  { file: 'test/desktop-client-locales.test.mjs', oid: '5bc5e52caab6b0451105b42d7818a35ab6b1ed5a', reason: 'downstream client UI regression coverage' },
  { file: 'test/desktop-client-ui.test.ts', oid: 'fe02280edbf0cbff7d9ae9468d8329de784c47ac', reason: 'downstream client UI regression coverage' },
  { file: 'test/linux-packaging.test.ts', oid: 'e1dd535053182f68c9fb16b3e689b5ec5ac104cc', reason: 'BISHENG Linux packaging coverage' },
  { file: 'test/packaged-layout.test.mjs', oid: '16c597d51b91822e70c958ac8f0e2d8ea2468e99', reason: 'BISHENG package layout coverage' },
  { file: 'test/repair-draft-ui.test.ts', oid: '4ed0e86106c1a16c4c26d19147f607bbcc3bb7a5', reason: 'downstream repair UI coverage' },
  { file: 'test/shell/deep-links.test.ts', oid: '804387cceb609ee3d3f5cbdf6afcf5a87e5275ec', reason: 'enterprise deep-link regression coverage' },
  { file: 'test/shell/product-identity.test.ts', oid: '0638a19805e219cbe07d406fe4120ee770c8323a', reason: 'upstream candidate: product protocol scheme regression coverage' },
  { file: 'test/workbench-client.test.mjs', oid: '2b5c9b6314d7846a3d9e12d648079c4f63c893e8', reason: 'downstream workbench regression coverage' },
  { file: 'test/workspace-unread-patch.test.ts', oid: 'bf6ca467dd8faa8dbb39b77e631077de87d8ada5', reason: 'downstream workspace regression coverage' }
]

export const PUBLIC_OVERRIDE_BY_FILE = new Map(PUBLIC_OVERRIDES.map(entry => [entry.file, entry]))
