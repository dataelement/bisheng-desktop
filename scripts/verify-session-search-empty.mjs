/** Exercise shipped search components, primitives and themes in isolated native Electron. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import electron from 'electron'

const root = resolve(import.meta.dirname, '..')
const output = resolve(process.env.SEARCH_VERIFY_OUTPUT || join(root, 'artifacts/session-search-empty'))
const temporary = await mkdtemp(join(tmpdir(), 'bisheng-search-empty-'))
try {
  await mkdir(output, { recursive: true })
  const workspace = await readFile(process.env.SEARCH_WORKSPACE_SOURCE || join(root, 'node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js'), 'utf8')
  const desktop = await readFile(process.env.SEARCH_DESKTOP_SOURCE || join(root, 'packages/dsh-desktop-client-ui/client.js'), 'utf8')
  const theme = await readFile(join(root, 'node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js'), 'utf8')
  const themeCss = theme.match(/var design_platform_css_default = ("[^\n]+");/)?.[1]
  const baseCss = theme.match(/var base_css_default = ("[^\n]+");/)?.[1]
  assert.ok(themeCss && baseCss, 'Installed theme exposes base and palette styles')
  const frontend = join(root, 'node_modules/@deepseek-ai/dsh-web-frontend/dist')
  const html = await readFile(join(frontend, 'index.html'), 'utf8')
  const entry = html.match(/<script[^>]*src="([^"?]+)/)?.[1]
  assert.ok(entry, 'Shipped frontend entry exists')
  await build({ entryPoints: [join(frontend, entry)], bundle: true, format: 'iife', outfile: join(temporary, 'shared.js') })
  const styles = await Promise.all([...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map(match => readFile(join(frontend, match[1]), 'utf8')))
  const workspaceCss = [...workspace.matchAll(/const css(?:\$\d+)? = ("[^\n]+");/g)].map(match => JSON.parse(match[1])).join('\n')
  const desktopCss = [...desktop.matchAll(/style.textContent = `([\s\S]*?)`/g)].find(match => match[1].includes('.dshSharedCollection'))?.[1]
  assert.ok(workspaceCss && desktopCss, 'Owning styles are available')
  await build({ stdin: { resolveDir: root, contents: `
    import { createSessionSearchFixture } from './test/helpers/session-search-fixture.mjs'
    const workspace = ${JSON.stringify(workspace)}, desktop = ${JSON.stringify(desktop)}
    const pause = () => new Promise(resolve => setTimeout(resolve, 350))
    window.mountSearch = async options => {
      window.fixture?.unmount()
      document.documentElement.lang = options.locale
      document.documentElement.dataset.platform = 'darwin'
      document.body.toggleAttribute('data-ds-dark-theme', options.dark)
      document.body.style.backgroundColor = 'var(--dsw-specific-sidebar-fill)'
      let finish
      window.fixture = createSessionSearchFixture(workspace, desktop, {
        ...options, runtime: window.fixtureModules,
        ...(options.pending ? {searchSessions: () => new Promise(resolve => {finish = resolve})} : {})
      })
      window.fixture.mount()
      window.finishSearch = () => finish({items: [], hasMore: false})
      await pause()
    }
    window.emptyNotices = () => [...fixture.host.querySelectorAll('div')].filter(node =>
      node.children.length === 0 && ['当前列表没有匹配的会话', '无匹配会话', 'No matches in the current list', 'No matching sessions'].includes(node.textContent)
    ).map(node => node.textContent)
  ` }, bundle: true, platform: 'browser', outfile: join(temporary, 'renderer.js'), define: { 'process.env.NODE_ENV': '"production"' } })
  await writeFile(join(temporary, 'index.html'), `<!doctype html><meta charset="utf-8"><style>${styles.join('\n')}${JSON.parse(baseCss)}${JSON.parse(themeCss)}${workspaceCss}${desktopCss}body{--dsh-sidebar-inline-padding:8px;margin:0;padding:18px 10px;font:14px/1.5 system-ui;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}body>div{height:550px;display:flex;flex-direction:column}</style><div id="root" style="display:none"></div><script>window.__ModuleLoader__={create(options){window.fixtureModules=options.staticModules;return {manifest:{plugins:[{id:'fixture',immediately:true}]},prefetch:()=>new Promise(()=>{})}}}</script><script src="shared.js"></script><script src="renderer.js"></script>`)
  await writeFile(join(temporary, 'main.cjs'), `
    const assert = require('node:assert/strict'), fs = require('node:fs/promises')
    const {app, BrowserWindow} = require('electron')
    app.setPath('userData', ${JSON.stringify(join(temporary, 'profile'))})
    app.whenReady().then(async () => {
      const win = new BrowserWindow({show:false,width:400,height:620,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
      win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message) })
      await win.loadFile(${JSON.stringify(join(temporary, 'index.html'))})
      const run = code => win.webContents.executeJavaScript(code)
      const step = code => run('(async()=>{' + code + ';await new Promise(resolve=>setTimeout(resolve,350))})()')
      const results = []
      for (const width of [284,400]) for (const dark of [false,true]) for (const locale of ['zh','en']) for (const shared of [false,true]) {
        const options = {width,dark,locale,shared}
        console.log('Checking '+JSON.stringify(options))
        win.setContentSize(width,620)
        await run('mountSearch('+JSON.stringify(options)+')')
        await step('fixture.openSearch();fixture.type("missing")')
        const notices = await run('emptyNotices()')
        const appearance = await run('({background:getComputedStyle(document.body).backgroundColor,fill:getComputedStyle(document.body).getPropertyValue("--dsw-alias-bg-layer-2"),height:document.body.getBoundingClientRect().height})')
        assert.ok(appearance.background.startsWith('rgb('), 'Fixture shell has an opaque theme surface')
        const filename = [width,dark?'dark':'light',locale,shared?'shared':'fallback'].join('-')+'.png'
        await fs.writeFile(${JSON.stringify(output)}+'/'+filename,(await win.webContents.capturePage()).toPNG())
        assert.equal(notices.length,1,'Empty search renders one notice: '+JSON.stringify(notices))
        await step('fixture.clear()')
        assert.ok((await run('fixture.host.textContent')).includes('会话 one'),'Clearing restores history')
        await step('fixture.openSearch();fixture.type("云端")')
        assert.equal(await run('fixture.host.querySelectorAll("[data-history-kind=chat]").length'),shared?1:0)
        assert.equal((await run('emptyNotices()')).length,shared?0:1,'Cloud matches replace the shared empty state')
        await run('mountSearch('+JSON.stringify({...options,pending:true})+')')
        await step('fixture.openSearch();fixture.type("missing")')
        assert.equal((await run('emptyNotices()')).length,0,'Pending search shows loading')
        assert.equal(await run('fixture.host.querySelectorAll("[role=status]").length'),1)
        await step('finishSearch()')
        assert.equal((await run('emptyNotices()')).length,1,'Finished empty search shows one notice')
        results.push({options,notices,appearance})
      }
      const result={hostPlatform:process.platform,electron:process.versions.electron,cases:results.length,results}
      await fs.writeFile(${JSON.stringify(join(output, 'result.json'))},JSON.stringify(result,null,2))
      console.log(JSON.stringify({hostPlatform:result.hostPlatform,electron:result.electron,cases:result.cases}))
      win.destroy();app.exit(0)
    }).catch(error=>{console.error(error);app.exit(1)})
  `)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electron, [join(temporary, 'main.cjs')], { env, stdio: 'inherit', signal: AbortSignal.timeout(180_000) })
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
  assert.equal(code, 0, 'Native search empty-state check passed')
} finally {
  await rm(temporary, { recursive: true, force: true })
}
