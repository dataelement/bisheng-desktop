/** Production cloud history, primitives and native Chat host against an isolated HTTP fixture. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const dir = await mkdtemp(join(tmpdir(), 'cloud-chat-delete-'))
const output = process.env.DSH_VERIFY_OUTPUT
try {
  await mkdir(join(dir, 'main'))
  await mkdir(join(dir, 'preload'))
  await copyFile(join(root, 'out/preload/enterprise-chat.cjs'), join(dir, 'preload/enterprise-chat.cjs'))
  const primitivePath = require.resolve('@deepseek-ai/dsh-client-ui-primitives')
  const primitiveSource = await readFile(primitivePath, 'utf8')
  const boundary = primitiveSource.indexOf('//#region lib/types/RiskConfirmation.js')
  assert.ok(boundary > 0)
  const themeSource = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-theme/client'), 'utf8')
  const themeCss = [...themeSource.matchAll(/var \w+_css_default = ("(?:[^"\\]|\\.)*");/g)].map(match => JSON.parse(match[1])).join('\n')
  assert.ok(themeCss.includes('--dsw-menu-surface-fill'))
  const desktop = await readFile(join(root, 'packages/dsh-desktop-client-ui/client.js'), 'utf8')
  await build({ stdin: { resolveDir: root, contents: `
    import React from 'react'
    import {createRoot} from 'react-dom/client'
    import * as primitives from 'fixture-primitives'
    const dictionaries = new Map(), slots = new Map(), disposers = []
    let language = 'zh'
    window.fixture = { setLanguage(value) { language = value; render() } }
    window.__ModuleLoader__ = {load({factory}) {
      const plugin = factory(name => name === 'react' ? React : primitives)
      plugin.apply({
        get: () => ({}),
        effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
        locale: {register(ns, copy) { dictionaries.set(ns, copy) }, bind: ns => (key, args = {}) => dictionaries.get(ns)[language][key]?.replace(/\\{(\\w+)\\}/g, (_, name) => args[name]), getSnapshot: () => ({active:language}), subscribe: () => () => {}},
        uiWorkspace: {registerNavigationHandler: () => () => {}},
        sessions: {list: {getSnapshot: () => ({phase:'ready',byId:{}}), subscribe: () => () => {}}},
        layout: {panelInfo: {getSnapshot: () => ({activePanelId:null}), subscribe: () => () => {}}},
        slots: {inject(name, fn) { if (['shell.overlay','sidebar.workspaces.collection','desktop.mode.content'].includes(name)) fn() }, register(meta, Component) { slots.set(meta.id, {Component, props:meta.inject()}) }}
      })
    }}
    new Function(${JSON.stringify(desktop)})()
    const collection = slots.get('desktop-shared-collection'), dialog = slots.get('desktop-cloud-chat-delete-dialog'), content = slots.get('desktop-chat-work')
    fixture.navigation = collection.props.navigation
    const app = createRoot(document.getElementById('root'))
    const render = () => app.render(React.createElement(React.Fragment, null,
      React.createElement('aside', {'data-dsh-sidebar-root':true}, React.createElement(collection.Component, {...collection.props, mode:'projects',query:'',archivedOnly:false,items:[],projects:()=>null})),
      React.createElement(content.Component, {...content.props, columns:'1fr',work:React.createElement('p',null,'Work')}),
      React.createElement(dialog.Component, dialog.props)))
    render()
  ` }, bundle: true, platform: 'browser', outfile: join(dir, 'renderer.js'), loader: { '.css': 'local-css' }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'primitives', setup(build) {
    build.onResolve({ filter: /^clsx$/ }, () => ({ path: 'clsx', namespace: 'fixture-clsx' }))
    build.onLoad({ filter: /.*/, namespace: 'fixture-clsx' }, () => ({ contents: 'export default (...values) => values.filter(Boolean).join(" ")' }))
    // Prune unused markdown/store imports outside the exercised primitive prefix.
    build.onResolve({ filter: /^[^./]/, namespace: 'fixture' }, args => ['react', 'react-dom', 'react/jsx-runtime', 'clsx'].includes(args.path) ? undefined : ({ path: args.path, external: true, sideEffects: false }))
    build.onResolve({ filter: /^fixture-primitives$/ }, () => ({ path: primitivePath, namespace: 'fixture' }))
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: primitiveSource.slice(0, boundary) + '\nexport {Modal,Menu,MenuItemButton,Button};', resolveDir: dirname(primitivePath) }))
  } }] })
  await writeFile(join(dir, 'index.html'), `<!doctype html><html data-platform="darwin"><meta charset="UTF-8"><link rel="stylesheet" href="renderer.css"><style>
    ${themeCss}
    body{margin:0;font:14px var(--dsw-font-family);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}#root{display:grid;grid-template-columns:260px 1fr;height:100vh}aside{padding:12px}
    </style><div id="root"></div><script src="renderer.js"></script></html>`)
  await writeFile(join(dir, 'owner.cjs'), `
    const {contextBridge,ipcRenderer} = require('electron')
    contextBridge.exposeInMainWorld('dshEnterpriseChat', {
      state:()=>ipcRenderer.invoke('fixture:state'), present:value=>ipcRenderer.invoke('fixture:present',value),
      history:page=>ipcRenderer.invoke('fixture:history',page), open:id=>ipcRenderer.invoke('fixture:open',id),
      remove:(id,epoch)=>ipcRenderer.invoke('fixture:remove',id,epoch),
      subscribe:fn=>{const listener=(_event,value)=>fn(value);ipcRenderer.on('enterprise-chat:changed',listener);return()=>ipcRenderer.removeListener('enterprise-chat:changed',listener)}
    })
  `)
  const entry = join(dir, 'main/main.mjs')
  await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import assert from 'node:assert/strict'
    import {createServer} from 'node:http'
    import {writeFile,mkdir} from 'node:fs/promises'
    import {app,BrowserWindow,ipcMain} from 'electron'
    import {EnterpriseChatView} from './src/main/enterprise/chat-view.ts'
    app.setPath('userData', ${JSON.stringify(join(dir, 'profile'))})
    app.whenReady().then(async()=>{
      const rows = Array.from({length:4},(_,i)=>({chat_id:'cloud-'+i,name:'云端会话 '+i,flow_type:15,update_time:'2026-11-03'}))
      let deleted = new Set(), attempts = new Map()
      const server = createServer((req,res)=>{
        res.setHeader('content-type',req.url.startsWith('/api/')?'application/json':'text/html')
        if(req.url.startsWith('/api/v1/chat/list')) return res.end(JSON.stringify({status_code:200,data:rows.filter(row=>!deleted.has(row.chat_id))}))
        if(req.method==='DELETE') {
          assert.ok(req.headers.cookie.includes('fixture=synthetic'))
          const id = req.url.split('/').at(-1), count = (attempts.get(id)||0)+1
          attempts.set(id,count)
          if(count===1) return res.end(JSON.stringify({status_code:500}))
          deleted.add(id); return res.end(JSON.stringify({status_code:200}))
        }
        res.end('<!doctype html><body>Isolated cloud conversation</body>')
      })
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
      const origin='http://127.0.0.1:'+server.address().port
      const owner=new BrowserWindow({show:false,width:1000,height:700,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:${JSON.stringify(join(dir,'owner.cjs'))}}})
      const host=new EnterpriseChatView({snapshot:()=>({connected:true,connectionKey:'fixture'}),subscribe:()=>()=>{},webSession:async()=>({base:origin,cookieName:'fixture',cookie:'synthetic',expiresAt:Date.now()+300000})},()=>{})
      for(const method of ['state','present','history','open','remove']) ipcMain.handle('fixture:'+method,(event,...args)=>{
        assert.equal(event.sender,owner.webContents);assert.equal(event.senderFrame,owner.webContents.mainFrame)
        return method==='state'?host.snapshot():method==='present'?host.present(owner,args[0]):host[method](...args)
      })
      const run=code=>owner.webContents.executeJavaScript(code)
      const wait=async check=>{for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,20))}throw new Error('Native cloud deletion timed out')}
      const click=async selector=>{await run('document.querySelector('+JSON.stringify(selector)+').click()');await new Promise(r=>setTimeout(r,60))}
      try {
        await owner.loadFile(${JSON.stringify(join(dir,'index.html'))})
        await wait(()=>run('document.querySelectorAll(".dshCloudHistoryActions").length===4'))
        let cases=0
        for(const language of ['zh','en']) for(const dark of [false,true]) {
          owner.webContents.setZoomFactor(dark ? 1.25 : 1)
          await run('fixture.setLanguage('+JSON.stringify(language)+');document.body.toggleAttribute("data-ds-dark-theme",'+dark+')')
          await click('[data-history-kind=chat]')
          await wait(()=>host.snapshot().conversationId==='cloud-'+cases)
          const view=owner.contentView.children.find(child=>child.webContents?.getURL().includes('/workspace'))
          assert.ok(view.getVisible(),'Native chat is visible before confirmation')
          await click('.dshCloudHistoryActions')
          assert.equal(await run('document.querySelector("[role=menu]").getBoundingClientRect().right <= document.querySelector("aside").getBoundingClientRect().right'),true,'Menu stays inside the sidebar and above native Chat')
          if(${JSON.stringify(output || '')}) {await mkdir(${JSON.stringify(output || '')},{recursive:true});await writeFile(${JSON.stringify(join(output || dir,'menu-'))}+cases+'.png',(await owner.webContents.capturePage()).toPNG())}
          await click('[role=menuitem]')
          await wait(()=>run('Boolean(document.querySelector("[role=dialog]"))'))
          await wait(()=>!view.getVisible())
          assert.equal(await run('(()=>{const r=document.querySelector("[role=dialog]").getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()'),true,'Confirmation fits the viewport')
          await run('Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})))')
          if(${JSON.stringify(output || '')}) await writeFile(${JSON.stringify(join(output || dir,'confirmation-'))}+cases+'.png',(await owner.webContents.capturePage()).toPNG())
          assert.equal(await run('document.activeElement.textContent'),language==='zh'?'取消':'Cancel')
          owner.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'})
          owner.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
          await wait(()=>run('document.querySelector("[role=dialog]")===null'))
          assert.equal(attempts.size,cases,'Cancel sends no DELETE')
          assert.equal(await run('document.activeElement.className'),'dshCloudHistoryActions')
          await click('.dshCloudHistoryActions');await click('[role=menuitem]')
          await run('[...document.querySelectorAll("[role=dialog] button")].at(-1).click()')
          await wait(()=>run('Boolean(document.querySelector("[role=alert]"))'))
          assert.equal(deleted.size,cases)
          await run('[...document.querySelectorAll("[role=dialog] button")].at(-1).click()')
          await wait(()=>host.snapshot().conversationId==='new')
          await wait(()=>run('document.querySelectorAll(".dshCloudHistoryActions").length==='+ (3-cases)))
          await wait(()=>view.getVisible())
          cases++
        }
        const result={cases,deleted:deleted.size,attempts:[...attempts.values()],platform:process.platform,electron:process.versions.electron,scope:'production UI primitives, cloud controller, native Chat view and authenticated loopback endpoint; fixture IPC transport'}
        if(${JSON.stringify(output || '')}) {await mkdir(${JSON.stringify(output || '')},{recursive:true});await writeFile(${JSON.stringify(join(output || dir,'result.json'))},JSON.stringify(result,null,2));await writeFile(${JSON.stringify(join(output || dir,'completed.png'))},(await owner.webContents.capturePage()).toPNG())}
        console.log(JSON.stringify(result))
      } finally {host.dispose();owner.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
      app.exit(0)
    }).catch(error=>{console.error(error);app.exit(1)})
  ` }, bundle: true, platform: 'node', format: 'esm', external: ['electron'], outfile: entry })
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [entry], { env, stdio: 'inherit', signal: AbortSignal.timeout(60_000) })
  assert.equal(await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) }), 0)
} finally { await rm(dir, { recursive: true, force: true }) }
