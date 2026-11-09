import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// The alpha.3 sidebar predates the Desktop quick-switcher slot.
const renderAnchor = '\t\t\t\t\tpanels.length > 0 && (0, react_jsx_runtime.jsxs)("nav", {'
const declarationAnchor = '\t\t\t\t\t"sidebar.panellist": {'
const panelAnchor = '\t\t\t\t\t"aria-label": label,\n\t\t\t\t\t"aria-current": active ? "page" : void 0,'

export function addWebSidebarSwitcher(source) {
  for (const anchor of [renderAnchor, declarationAnchor, panelAnchor]) {
    if (source.split(anchor).length !== 2) throw new Error('Unsupported alpha.3 sidebar: slot anchor is missing or ambiguous')
  }
  if (source.includes('sidebar.quickSwitcher')) throw new Error('Sidebar already declares quickSwitcher; review the upstream contract')
  return source
    .replace(renderAnchor, '\t\t\t\t\trenderSlot("sidebar.quickSwitcher", { wide, startSession, usePanelInfo }),\n' + renderAnchor)
    .replace(declarationAnchor, '\t\t\t\t\t"sidebar.quickSwitcher": { kind: "single", scope: "root" },\n' + declarationAnchor)
    .replace(panelAnchor, '\t\t\t\t\t"data-dsh-panel-id": id,\n' + panelAnchor)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const directory = process.argv[2]
  if (!directory || !path.isAbsolute(directory)) throw new Error('An absolute staged package path is required')
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-client-ui-sidebar' || manifest.version !== '0.2.2-alpha.3') throw new Error('Unsupported sidebar package')
  const client = path.join(directory, 'lib/client.js')
  await writeFile(client, addWebSidebarSwitcher(await readFile(client, 'utf8')))
}
