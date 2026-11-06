/** Production cloud projects/history, primitives and native Chat against an isolated HTTP fixture. */
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
        layout: {selectPanel() {}, panelInfo: {getSnapshot: () => ({activePanelId:null}), subscribe: () => () => {}}},
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
      history:page=>ipcRenderer.invoke('fixture:history',page), open:(id,projectId)=>ipcRenderer.invoke('fixture:open',id,projectId),
      remove:(id,epoch)=>ipcRenderer.invoke('fixture:remove',id,epoch),
      projectsState:()=>ipcRenderer.invoke('fixture:projectsState'),
      projectAction:(action,epoch)=>ipcRenderer.invoke('fixture:projectAction',action,epoch),
      projectConversations:(page,epoch)=>ipcRenderer.invoke('fixture:projectConversations',page,epoch),
      onProjectsChanged:fn=>{const listener=(_event,value)=>fn(value);ipcRenderer.on('enterprise-chat:projects-changed',listener);return()=>ipcRenderer.removeListener('enterprise-chat:projects-changed',listener)},
      subscribe:fn=>{const listener=(_event,value)=>fn(value);ipcRenderer.on('enterprise-chat:changed',listener);return()=>ipcRenderer.removeListener('enterprise-chat:changed',listener)}
    })
  `)
  const entry = join(dir, 'main/main.mjs')
  await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import assert from 'node:assert/strict'
    import {createServer} from 'node:http'
    import {randomUUID} from 'node:crypto'
    import {writeFile,mkdir} from 'node:fs/promises'
    import {app,BrowserWindow,ipcMain} from 'electron'
    import {EnterpriseChatView} from './src/main/enterprise/chat-view.ts'
    app.setPath('userData', ${JSON.stringify(join(dir, 'profile'))})
    app.whenReady().then(async()=>{
      const rows = Array.from({length:4},(_,i)=>({chat_id:'cloud-'+i,name:'云端会话 '+i,flow_type:15,update_time:'2026-11-03'}))
      let deleted = new Set(), attempts = new Map(), revision = 0
      let projects = [], memberships = {}
      const subscribers = new Set(), receipts = new Map()
      const frame = (res,event) => res.write('event: '+event+'\\ndata: '+JSON.stringify({protocol_version:1,revision:String(revision),notification:'live'})+'\\n\\n')
      const broadcast = () => {for(const res of subscribers) frame(res,'changed')}
      const server = createServer(async (req,res)=>{
        res.setHeader('content-type',req.url.startsWith('/api/')?'application/json':'text/html')
        const url = new URL(req.url,'http://fixture')
        if(url.pathname.startsWith('/api/v1/chat/projects')) {
          assert.ok(req.headers.cookie?.includes('fixture=synthetic'))
          const reply = data => res.end(JSON.stringify({status_code:200,data}))
          if(url.pathname.endsWith('/events')) {
            res.setHeader('content-type','text/event-stream');res.setHeader('cache-control','no-store')
            subscribers.add(res); frame(res,'ready')
            const heartbeat=setInterval(()=>frame(res,'heartbeat'),15000)
            res.on('close',()=>{subscribers.delete(res);clearInterval(heartbeat)})
            return
          }
          if(url.pathname.endsWith('/snapshot')) return reply({protocol_version:1,identity:{user_id:7,tenant_id:1},revision:String(revision),projects,memberships:Object.entries(memberships).map(([chat_id,project_id])=>({chat_id,project_id})),next_cursor:null})
          if(url.pathname.endsWith('/conversations')) {
            const list=rows.filter(row=>!deleted.has(row.chat_id)&&memberships[row.chat_id]&&(url.searchParams.get('project_id')?memberships[row.chat_id]===url.searchParams.get('project_id'):row.name.toLowerCase().includes((url.searchParams.get('query')||'').toLowerCase())))
            return reply({data:list,total:list.length,revision:String(revision),next_cursor:null})
          }
          if(url.pathname.endsWith('/actions')) {
            const chunks=[];for await(const chunk of req) chunks.push(chunk)
            const action=JSON.parse(Buffer.concat(chunks).toString()), previous=receipts.get(action.request_id)
            if(previous) return reply({...previous,revision:String(revision),replayed:true})
            const outcome={}
            if(action.operation==='create') {
              const project={id:randomUUID(),name:action.name};projects.unshift(project);outcome.project_id=project.id
              if(action.chat_id) memberships[action.chat_id]=project.id
            } else if(action.operation==='rename') projects=projects.map(project=>project.id===action.project_id?{...project,name:action.name}:project)
            else if(action.operation==='delete') {
              projects=projects.filter(project=>project.id!==action.project_id)
              memberships=Object.fromEntries(Object.entries(memberships).filter(([,id])=>id!==action.project_id))
            } else if(action.operation==='assign') {
              if(action.project_id) memberships[action.chat_id]=action.project_id
              else delete memberships[action.chat_id]
            } else throw new Error('Unexpected fixture operation')
            revision++;broadcast()
            const result={revision:String(revision),applied_revision:String(revision),replayed:false,notification:'live',outcome}
            receipts.set(action.request_id,result);return reply(result)
          }
        }
        if(req.url.startsWith('/api/v1/chat/list')) return res.end(JSON.stringify({status_code:200,data:rows.filter(row=>!deleted.has(row.chat_id)&&!row.chat_id.startsWith('project-'))}))
        if(req.method==='DELETE') {
          assert.ok(req.headers.cookie.includes('fixture=synthetic'))
          const id = req.url.split('/').at(-1), count = (attempts.get(id)||0)+1
          attempts.set(id,count)
          if(count===1) return res.end(JSON.stringify({status_code:500}))
          deleted.add(id);delete memberships[id];revision++;broadcast();return res.end(JSON.stringify({status_code:200}))
        }
        res.end('<!doctype html><body>Isolated cloud conversation</body>')
      })
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
      const origin='http://127.0.0.1:'+server.address().port
      const owner=new BrowserWindow({show:true,width:1000,height:700,webPreferences:{backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false,preload:${JSON.stringify(join(dir,'owner.cjs'))}}})
      const host=new EnterpriseChatView({snapshot:()=>({connected:true,connectionKey:'fixture'}),subscribe:()=>()=>{},webSession:async()=>({base:origin,cookieName:'fixture',cookie:'synthetic',expiresAt:Date.now()+300000})},line=>console.log(line))
      for(const method of ['state','present','history','open','remove','projectsState','projectAction','projectConversations']) ipcMain.handle('fixture:'+method,(event,...args)=>{
        assert.equal(event.sender,owner.webContents);assert.equal(event.senderFrame,owner.webContents.mainFrame)
        return method==='state'?host.snapshot():method==='present'?host.present(owner,args[0]):host[method](...args)
      })
      const run=code=>owner.webContents.executeJavaScript(code)
      const wait=async check=>{for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,20))}console.error('Fixture timeout',await run('JSON.stringify({hidden:document.hidden,focused:document.hasFocus(),dialog:document.querySelector("[role=dialog]")?.outerHTML.slice(0,1500),visibility:document.querySelector("[role=dialog]")?.checkVisibility({checkVisibilityCSS:true}),projects:fixture.navigation.projects.snapshot()})'));throw new Error('Native cloud deletion timed out')}
      const click=async selector=>{await run('document.querySelector('+JSON.stringify(selector)+').click()');await new Promise(r=>setTimeout(r,60))}
      const menu=async label=>{await run('[...document.querySelectorAll("[role=menuitem]")].find(node=>node.textContent==='+JSON.stringify(label)+').click()');await new Promise(r=>setTimeout(r,60))}
      const webAction=async operation=>{const response=await fetch(origin+'/api/v1/chat/projects/actions',{method:'POST',headers:{'Content-Type':'application/json',Cookie:'fixture=synthetic'},body:JSON.stringify({...operation,request_id:randomUUID()})});assert.equal((await response.json()).status_code,200)}
      try {
        await owner.loadFile(${JSON.stringify(join(dir,'index.html'))})
        app.focus({steal:true});owner.focus()
        await wait(()=>run('document.querySelectorAll(".dshCloudHistoryActions").length===4'))
        let projectId
        for(const language of ['zh','en']) for(const dark of [false,true]) {
          await run('fixture.setLanguage('+JSON.stringify(language)+');document.body.toggleAttribute("data-ds-dark-theme",'+dark+')')
          await click('.dshChatProjects>.dshHistoryHeading button')
          await wait(()=>run('Boolean(document.querySelector(".dshChatProjectForm input"))'))
          const view=owner.contentView.children.find(child=>child.webContents?.getURL().includes('/workspace'))
          await wait(()=>!view.getVisible())
          assert.equal(await run('document.activeElement.tagName'),'INPUT','Project dialog focuses the name field')
          // Type through Electron so React receives actual keyboard/input events.
          await owner.webContents.insertText(language==='zh'?'研究项目':'Research project')
          await wait(()=>run('!document.querySelector("[role=dialog] button[type=submit]").disabled'))
          await click('[role=dialog] button[type=submit]')
          await wait(()=>run('document.querySelector("[role=dialog]")===null'))
          projectId=await run('fixture.navigation.projects.snapshot().projects[0].id')
          await click('.dshRecentHistory .dshCloudHistoryActions')
          await menu(language==='zh'?'移入项目':'Move to project')
          await wait(()=>run('Boolean(document.querySelector(".dshChatProjectForm select"))'))
          await click('[role=dialog] button[type=submit]')
          await wait(()=>run('document.querySelectorAll("[data-chat-project] [data-history-kind=chat]").length===1'))
          assert.equal(await run('document.querySelectorAll("[data-history-kind=chat]").length'),4,'Project membership does not duplicate a conversation')
          if(${JSON.stringify(output || '')}) {await mkdir(${JSON.stringify(output || '')},{recursive:true});await writeFile(${JSON.stringify(output || dir)}+'/project-'+language+'-'+dark+'.png',(await owner.webContents.capturePage()).toPNG())}
          await run('(async()=>{await fixture.navigation.projects.assign("cloud-0",undefined);fixture.navigation.projects.edit("remove",'+JSON.stringify(projectId)+',"Research")})()')
          await wait(()=>run('Boolean(document.querySelector(".dshChatProjectForm"))'))
          await click('[role=dialog] button[type=submit]')
          await wait(()=>run('document.querySelectorAll("[data-chat-project]").length===0'))
          assert.equal(deleted.size,0,'Removing a project keeps all cloud conversations')
        }
        await run('fixture.navigation.projects.edit("create");fixture.navigation.projects.confirm("Persistent project")')
        projectId=await run('fixture.navigation.projects.snapshot().projects[0].id')
        await owner.loadFile(${JSON.stringify(join(dir,'index.html'))})
        await wait(()=>run('document.querySelectorAll("[data-chat-project]").length===1'))
        await click('[data-chat-project] .dshChatProjectAction')
        await wait(()=>host.snapshot().draftProjectId===projectId)
        const projectView=owner.contentView.children.find(child=>child.webContents?.getURL().includes('/workspace'))
        await projectView.webContents.executeJavaScript('history.pushState({},"","/workspace/c/project-created")')
        assert.equal(await run('fixture.navigation.projects.snapshot().assignments["project-created"]'),undefined,'Navigation alone cannot create membership')
        rows.push({chat_id:'project-created',name:'Old project conversation',flow_type:15,flow_id:'',update_time:'2020-01-01'})
        await webAction({operation:'assign',chat_id:'project-created',project_id:projectId})
        await wait(()=>run('Object.keys(fixture.navigation.projects.snapshot().assignments).includes("project-created")'))
        assert.equal(await run('fixture.navigation.projects.snapshot().assignments["project-created"]'),projectId,'New conversation belongs to its originating project')
        await wait(()=>run('document.querySelector("[data-chat-project]").textContent.includes("Old project conversation")'))
        const changedAt=Date.now()
        await webAction({operation:'rename',project_id:projectId,name:'Renamed from Web'})
        await wait(()=>run('document.querySelector("[data-chat-project]").textContent.includes("Renamed from Web")'))
        const syncLatencyMs=Date.now()-changedAt
        assert.ok(syncLatencyMs<2000,'Open Desktop updates without refresh/focus within the healthy target')
        await run('fixture.navigation.projects.edit("rename",'+JSON.stringify(projectId)+',"Renamed from Web");fixture.navigation.projects.confirm("Renamed from Desktop")')
        const webSnapshot=await (await fetch(origin+'/api/v1/chat/projects/snapshot',{headers:{Cookie:'fixture=synthetic'}})).json()
        assert.equal(webSnapshot.data.projects[0].name,'Renamed from Desktop','Desktop changes are visible to a separate HTTP client')
        for(const client of subscribers) client.destroy()
        projects[0].name='Recovered after disconnect';revision++
        await wait(()=>run('document.querySelector("[data-chat-project]").textContent.includes("Recovered after disconnect")'))
        await webAction({operation:'assign',chat_id:'project-created',project_id:null})
        rows.pop()
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
          await menu(language==='zh'?'删除':'Delete')
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
          await click('.dshCloudHistoryActions');await menu(language==='zh'?'删除':'Delete')
          await run('[...document.querySelectorAll("[role=dialog] button")].at(-1).click()')
          await wait(()=>run('Boolean(document.querySelector("[role=alert]"))'))
          assert.equal(deleted.size,cases)
          await run('[...document.querySelectorAll("[role=dialog] button")].at(-1).click()')
          await wait(()=>host.snapshot().conversationId==='new')
          await wait(()=>run('document.querySelectorAll(".dshCloudHistoryActions").length==='+ (3-cases)))
          await wait(()=>view.getVisible())
          cases++
        }
        const result={cases,projectCases:4,projectPersistence:true,serverMembership:true,bidirectionalSync:true,reconnect:true,olderProjectHistory:true,syncLatencyMs,deleted:deleted.size,attempts:[...attempts.values()],platform:process.platform,electron:process.versions.electron,scope:'production UI primitives, project/history controllers, native Chat view and authenticated loopback fixture; no production deployment'}
        if(${JSON.stringify(output || '')}) {await mkdir(${JSON.stringify(output || '')},{recursive:true});await writeFile(${JSON.stringify(join(output || dir,'result.json'))},JSON.stringify(result,null,2));await writeFile(${JSON.stringify(join(output || dir,'completed.png'))},(await owner.webContents.capturePage()).toPNG())}
        console.log(JSON.stringify(result))
      } finally {host.dispose();owner.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
      app.exit(0)
    }).catch(error=>{console.error(error);app.exit(1)})
  ` }, bundle: true, platform: 'node', format: 'esm', external: ['electron'], outfile: entry })
  const env = { ...process.env }
  if (output) { await mkdir(output, {recursive:true}); await copyFile(entry, join(output,'main-source.mjs')) }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [entry], { env, stdio: 'inherit', signal: AbortSignal.timeout(120_000) })
  assert.equal(await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) }), 0)
} finally { await rm(dir, { recursive: true, force: true }) }
