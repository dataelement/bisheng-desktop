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
  const timeStart = primitiveSource.indexOf('//#region lib/types/relative-time.js')
  const timeEnd = primitiveSource.indexOf('//#region lib/types/rank-by-name.js', timeStart)
  assert.ok(boundary > 0 && timeStart > boundary && timeEnd > timeStart)
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
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
      contents: primitiveSource.slice(0, boundary) + primitiveSource.slice(timeStart, timeEnd) + '\nexport {Modal,Menu,MenuItemButton,Button,HoverCard,relativeTime,IconChevronRightOutlineRegular,IconEditOutlineRegular,IconEllipsisOutlineRegular,IconFolderCloseRegular,IconFolderOpenRegular,IconNewChatOutlineRegular,IconPlusOutlineRegular,IconTrashOutlineRegular,IconTriangleRightFillRegular};',
      resolveDir: dirname(primitivePath)
    }))
  } }] })
  await writeFile(join(dir, 'index.html'), `<!doctype html><html data-platform="darwin"><meta charset="UTF-8"><link rel="stylesheet" href="renderer.css"><style>
    ${themeCss}
    body{margin:0;font:14px var(--dsw-font-family);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}#root{display:grid;grid-template-columns:260px 1fr;height:100vh}aside{padding:12px}
    </style><div id="root"></div><script src="renderer.js"></script></html>`)
  await writeFile(join(dir, 'owner.cjs'), `
    const {contextBridge,ipcRenderer} = require('electron')
    contextBridge.exposeInMainWorld('dshEnterpriseChat', {
      state:()=>ipcRenderer.invoke('fixture:state'), present:value=>ipcRenderer.invoke('fixture:present',value), capture:()=>ipcRenderer.invoke('fixture:capture'),
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
      const longTitle = '用于验收长标题滚动的云端对话 · A cloud conversation with a very long title'
      const rows = Array.from({length:4},(_,i)=>({chat_id:'cloud-'+i,name:i===0?longTitle:'云端会话 '+i,flow_type:15,update_time:new Date(Date.now()-(5+i)*60_000).toISOString()}))
      let deleted = new Set(), attempts = new Map()
      let projects = [], memberships = {}
      const server = createServer(async (req,res)=>{
        res.setHeader('content-type',req.url.startsWith('/api/')?'application/json':'text/html')
        const url = new URL(req.url,'http://fixture')
        if(url.pathname.startsWith('/api/v1/chat/projects')) {
          assert.ok(req.headers.cookie?.includes('fixture=synthetic'))
          const reply = data => res.end(JSON.stringify({status_code:200,data}))
          if(url.pathname.endsWith('/snapshot')) return reply({identity:{user_id:7,tenant_id:1},projects,memberships:Object.entries(memberships).map(([chat_id,project_id])=>({chat_id,project_id}))})
          if(url.pathname.endsWith('/conversations')) {
            const list=rows.filter(row=>!deleted.has(row.chat_id)&&memberships[row.chat_id]&&(url.searchParams.get('project_id')?memberships[row.chat_id]===url.searchParams.get('project_id'):row.name.toLowerCase().includes((url.searchParams.get('query')||'').toLowerCase())))
            return reply({data:list,total:list.length,next_cursor:null})
          }
          if(url.pathname.endsWith('/actions')) {
            const chunks=[];for await(const chunk of req) chunks.push(chunk)
            const action=JSON.parse(Buffer.concat(chunks).toString())
            const outcome={}
            if(action.operation==='create') {
              // Client-generated id: a retried create returns the existing project.
              if(!projects.some(project=>project.id===action.project_id)) projects.unshift({id:action.project_id,name:action.name})
              outcome.project_id=action.project_id
              if(action.chat_id) memberships[action.chat_id]=project.id
            } else if(action.operation==='rename') projects=projects.map(project=>project.id===action.project_id?{...project,name:action.name}:project)
            else if(action.operation==='delete') {
              projects=projects.filter(project=>project.id!==action.project_id)
              memberships=Object.fromEntries(Object.entries(memberships).filter(([,id])=>id!==action.project_id))
            } else if(action.operation==='assign') {
              if(action.project_id) memberships[action.chat_id]=action.project_id
              else delete memberships[action.chat_id]
            } else throw new Error('Unexpected fixture operation')
            return reply({outcome})
          }
        }
        if(req.url.startsWith('/api/v1/chat/list')) return res.end(JSON.stringify({status_code:200,data:rows.filter(row=>!deleted.has(row.chat_id)&&!row.chat_id.startsWith('project-'))}))
        if(req.method==='DELETE') {
          assert.ok(req.headers.cookie.includes('fixture=synthetic'))
          const id = req.url.split('/').at(-1), count = (attempts.get(id)||0)+1
          attempts.set(id,count)
          if(count===1) return res.end(JSON.stringify({status_code:500}))
          deleted.add(id);delete memberships[id];return res.end(JSON.stringify({status_code:200}))
        }
        res.end('<!doctype html><body>Isolated cloud conversation</body>')
      })
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
      const origin='http://127.0.0.1:'+server.address().port
      const owner=new BrowserWindow({show:false,width:1000,height:700,webPreferences:{backgroundThrottling:false,sandbox:true,contextIsolation:true,nodeIntegration:false,preload:${JSON.stringify(join(dir,'owner.cjs'))}}})
      owner.setIgnoreMouseEvents(true)
      const input=(method,params)=>owner.webContents.debugger.sendCommand(method,params)
      const host=new EnterpriseChatView({snapshot:()=>({connected:true,connectionKey:'fixture'}),subscribe:()=>()=>{},webSession:async()=>({base:origin,cookieName:'fixture',cookie:'synthetic',expiresAt:Date.now()+300000})},line=>console.log(line))
      for(const method of ['state','present','capture','history','open','remove','projectsState','projectAction','projectConversations']) ipcMain.handle('fixture:'+method,(event,...args)=>{
        assert.equal(event.sender,owner.webContents);assert.equal(event.senderFrame,owner.webContents.mainFrame)
        return method==='state'?host.snapshot():method==='present'?host.present(owner,args[0]):method==='capture'?host.capture(owner):host[method](...args)
      })
      const run=code=>owner.webContents.executeJavaScript(code)
      // No push channel: another client's edit appears when a Desktop window regains focus.
      const focusAgain=async()=>{await new Promise(r=>setTimeout(r,1100));app.emit('browser-window-focus')}
      const wait=async check=>{for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,20))}console.error('Fixture timeout',await run('JSON.stringify({hidden:document.hidden,focused:document.hasFocus(),active:document.activeElement.outerHTML.slice(0,220),dialog:document.querySelector("[role=dialog]")?.outerHTML.slice(0,1500),visibility:document.querySelector("[role=dialog]")?.checkVisibility({checkVisibilityCSS:true}),overlay:[...document.querySelectorAll("[data-dsh-chat-history-preview],[role=menu]")].map(node=>({bounds:node.getBoundingClientRect().toJSON(),visible:node.checkVisibility({opacityProperty:true}),pending:!!node.closest("[data-dsh-native-overlay-pending]")})),backing:!!document.querySelector("[data-dsh-native-frame]"),projects:fixture.navigation.projects.snapshot()})'));throw new Error('Native cloud deletion timed out')}
      const click=async selector=>{await run('document.querySelector('+JSON.stringify(selector)+').click()');await new Promise(r=>setTimeout(r,60))}
      const menu=async label=>{await run('[...document.querySelectorAll("[role=menuitem]")].find(node=>node.textContent==='+JSON.stringify(label)+').click()');await new Promise(r=>setTimeout(r,60))}
      const point=selector=>run('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()')
      const move=async selector=>input('Input.dispatchMouseEvent',{type:'mouseMoved',...await point(selector)})
      const clickMouse=async (selector,button='left')=>{
        const location=await point(selector)
        for(const type of ['mousePressed','mouseReleased']) await input('Input.dispatchMouseEvent',{type,button,clickCount:1,...location})
      }
      const key=async (key,windowsVirtualKeyCode,code=key)=>{
        for(const type of ['rawKeyDown','keyUp']) await input('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode})
      }
      const toolVisible=selector=>run('getComputedStyle(document.querySelector('+JSON.stringify(selector)+')).opacity==="1"')
      const shown=selector=>run('document.querySelector('+JSON.stringify(selector)+')?.checkVisibility({checkVisibilityCSS:true,opacityProperty:true})===true')
      const recentRow='.dshRecentHistory .dshCloudHistoryRow'
      const recentTool=recentRow+' .dshCloudHistoryActions'
      const filedRow='.dshChatProject .dshCloudHistoryRow'
      const filedTool=filedRow+' .dshCloudHistoryActions'
      const projectTrigger='.dshCloudHistoryMenu button[aria-haspopup="menu"]'
      const projectSubmenu='.dshCloudHistoryMenu [role=menu]'
      const firstProject=projectSubmenu+' > button:nth-of-type(2)'
      const moveOut=projectSubmenu+' > button:has(.dshChatProjectMenuRemove)'
      const submenuRows=()=>run('[...document.querySelectorAll(".dshCloudHistoryMenu [role=menu] > button")].map(row=>[row.textContent,getComputedStyle(row,"::before").height==="1px"])')
      const webAction=async operation=>{const response=await fetch(origin+'/api/v1/chat/projects/actions',{method:'POST',headers:{'Content-Type':'application/json',Cookie:'fixture=synthetic'},body:JSON.stringify(operation.operation==='create'?{project_id:randomUUID(),...operation}:operation)});assert.equal((await response.json()).status_code,200)}
      try {
        await owner.loadFile(${JSON.stringify(join(dir,'index.html'))})
        owner.showInactive()
        // Send trusted Chromium input to the fixture, independent of which macOS window has focus.
        owner.webContents.debugger.attach('1.3')
        await input('Emulation.setFocusEmulationEnabled',{enabled:true})
        await wait(()=>run('document.querySelectorAll(".dshCloudHistoryActions").length===4'))
        const rowGaps=await run('(() => { const rows = [...document.querySelectorAll(".dshRecentHistory .dshCloudHistoryRow")].map(row => row.getBoundingClientRect()); return rows.slice(1).map((row, index) => row.top - rows[index].bottom) })()')
        assert.deepEqual(rowGaps,[2,2,2],'Conversation rows have the same 2px gap as the native DSH list')
        await move('.dshHistoryHeading')
        await wait(()=>shown(recentRow+' time'))
        assert.equal(await toolVisible(recentTool),false,'Resting rows reserve the trailing position for time')
        await move(recentRow)
        await wait(()=>toolVisible(recentTool))
        assert.equal(await shown(recentRow+' time'),false,'Time yields to the hover action')
        await wait(()=>run('document.querySelector(".dshRecentHistory .dshHistoryTitle").scrollLeft>0'))
        const preview='[data-dsh-chat-history-preview]'
        await wait(()=>shown(preview))
        assert.ok((await run('document.querySelector("[data-dsh-chat-history-preview]").textContent')).includes(longTitle))
        const initialView=owner.contentView.children.find(child=>child.webContents?.getURL().includes('/workspace'))
        assert.equal(initialView.getVisible(),false,'Native Chat yields to the overlapping preview')
        assert.equal(await run('Boolean(document.querySelector("[data-dsh-native-frame]"))'),true,'The native content remains visible as backing under the preview')
        const previousConversation=host.snapshot().conversationId
        await clickMouse(recentRow,'right')
        await wait(()=>shown('[role=menu]'))
        assert.equal(await shown(preview),false,'Opening the context menu dismisses the preview')
        assert.equal(host.snapshot().conversationId,previousConversation,'Right-click does not open the conversation')
        await key('Escape',27)
        await wait(()=>run('document.querySelector("[role=menu]")===null'))
        await run('document.activeElement.blur()')
        await move('.dshHistoryHeading')
        await wait(()=>shown(recentRow+' time'))
        await wait(()=>initialView.getVisible())
        assert.equal(await run('document.querySelector(".dshRecentHistory .dshHistoryTitle").scrollLeft'),0,'Leaving resets the title')
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
          const testLongMenu=language==='en'&&dark
          if(testLongMenu) {
            projects.push(...Array.from({length:18},(_,i)=>({id:randomUUID(),name:'Additional project '+i})))
            await focusAgain()
            await wait(()=>run('document.querySelectorAll("[data-chat-project]").length===19'))
            await run('document.querySelector("aside").style.overflow="auto";document.querySelector(".dshRecentHistory .dshHistoryRow").scrollIntoView({block:"end"})')
          }
          await wait(()=>view.getVisible())
          await move(recentRow)
          await wait(()=>toolVisible(recentTool))
          await clickMouse(recentTool)
          await wait(()=>shown('.dshCloudHistoryMenu'))
          assert.equal(await shown(projectSubmenu),false,'Opening the conversation menu does not open the project picker')
          assert.equal(await shown(projectTrigger+' .dshChatProjectMenuLabel svg'),true,'The project picker shows a trailing chevron')
          await move(projectTrigger)
          await wait(()=>shown(projectSubmenu))
          assert.deepEqual((await submenuRows()).slice(0,2),[
            [language==='zh'?'新建项目':'New project',false],
            [language==='zh'?'研究项目':'Research project',true]
          ],'New project is first and separated from the destination rows')
          const geometry=await run('(()=>{const root=document.querySelector(".dshCloudHistoryMenu").getBoundingClientRect();const el=document.querySelector(".dshCloudHistoryMenu [role=menu]");const sub=el.getBoundingClientRect();return {right:sub.left>=root.right,inside:sub.top>=0&&sub.bottom<=innerHeight&&sub.right<=innerWidth,scrollable:el.scrollHeight>el.clientHeight}})()')
          assert.ok(geometry.right&&geometry.inside,'The project submenu opens to the right and stays inside the window')
          assert.equal(geometry.scrollable,testLongMenu)
          assert.equal(view.getVisible(),false,'Chat yields when the submenu extends over it')
          if(testLongMenu) {
            await run('document.querySelector(".dshCloudHistoryMenu [role=menu]").scrollTop=1e4')
            assert.ok(await run('document.querySelector(".dshCloudHistoryMenu [role=menu]").scrollTop>0'))
            await run('document.querySelector(".dshCloudHistoryMenu [role=menu]").scrollTop=0')
          }
          await move(firstProject)
          await wait(()=>shown(projectSubmenu))
          await clickMouse(firstProject)
          await wait(()=>run('document.querySelectorAll("[data-chat-project] [data-history-kind=chat]").length===1'))
          await wait(()=>run('!fixture.navigation.projects.snapshot().assigning.has("cloud-0")'))
          assert.equal(memberships['cloud-0'],projectId)
          assert.equal(await run('document.querySelector("[role=dialog]")===null'),true,'Selecting an existing project files the conversation directly')
          assert.equal(await run('document.querySelectorAll("[data-history-kind=chat]").length'),4,'Project membership does not duplicate a conversation')
          if(testLongMenu) {
            projects=projects.filter(project=>project.id===projectId);await focusAgain()
            await wait(()=>run('document.querySelectorAll("[data-chat-project]").length===1'))
            await run('document.querySelector("aside").style.overflow=""')
          }
          await run('document.activeElement.blur()')
          await move('.dshHistoryHeading')
          await wait(()=>shown(filedRow+' time'))
          assert.equal(await toolVisible(filedTool),false)
          const age=await run('document.querySelector(".dshChatProject .dshHistoryRow time").textContent')
          assert.match(age,language==='zh'?/^[0-9]+分钟$/:/^[0-9]+min$/)
          await move('.dshChatProjectToggle')
          await wait(()=>shown('.dshChatProjectChevron'))
          assert.equal(await shown('.dshChatProjectFolder'),false)
          assert.equal(await toolVisible('.dshChatProjectHeading .dshChatProjectAction'),true)
          await move(filedRow)
          await wait(()=>toolVisible(filedTool))
          assert.equal(await shown(filedRow+' time'),false)
          await move('.dshHistoryHeading')
          await wait(()=>view.getVisible())
          await run('document.querySelector(".dshChatProject .dshHistoryRow").focus()')
          await key('Tab',9)
          await wait(()=>run('document.activeElement.matches(".dshChatProject .dshCloudHistoryActions")'))
          assert.equal(await toolVisible(filedTool),true,'Tab exposes the otherwise hidden menu trigger')
          await key(' ',32,'Space')
          await wait(()=>shown('[role=menu]'))
          if(!await run('document.activeElement.matches(".dshCloudHistoryMenu button[aria-haspopup=menu]")')) await key('Home',36)
          await wait(()=>run('document.activeElement.matches(".dshCloudHistoryMenu button[aria-haspopup=menu]")'))
          await wait(()=>shown(projectSubmenu))
          assert.deepEqual(await submenuRows(),[
            [language==='zh'?'新建项目':'New project',false],
            [language==='zh'?'移出项目':'Move out of project',true]
          ],'The current project is excluded and the last action has one divider')
          await key('ArrowRight',39)
          await wait(()=>run('document.activeElement.matches(".dshCloudHistoryMenu [role=menu] button")'))
          assert.equal(await run('document.activeElement.textContent'),language==='zh'?'新建项目':'New project','Current project is excluded from the targets')
          await key('ArrowLeft',37)
          await wait(()=>run('document.activeElement.matches(".dshCloudHistoryMenu button[aria-haspopup=menu]")'))
          if(language==='zh'&&!dark) {
            await key('ArrowRight',39)
            await key(' ',32,'Space')
            await wait(()=>shown('.dshChatProjectForm input'))
            assert.equal(await run('document.activeElement.matches(".dshChatProjectForm input")'),true,'New project from the submenu focuses the name field')
            await key('Escape',27)
            await wait(()=>run('document.querySelector("[role=dialog]")===null'))
          }
          await key('Escape',27)
          await wait(()=>run('document.querySelector("[role=menu]")===null'))
          assert.equal(await run('document.activeElement.classList.contains("dshCloudHistoryActions")'),true)
          if(${JSON.stringify(output || '')}) {await mkdir(${JSON.stringify(output || '')},{recursive:true});await writeFile(${JSON.stringify(output || dir)}+'/project-'+language+'-'+dark+'.png',(await owner.webContents.capturePage()).toPNG())}
          await click(filedTool)
          await wait(()=>shown(projectTrigger))
          await move(projectTrigger)
          await wait(()=>shown(moveOut))
          await move(moveOut)
          await clickMouse(moveOut)
          await wait(()=>run('!fixture.navigation.projects.snapshot().assignments["cloud-0"]&&!fixture.navigation.projects.snapshot().assigning.has("cloud-0")'))
          assert.equal(memberships['cloud-0'],undefined,'Selecting the bottom action removes the conversation from the project')
          await run('fixture.navigation.projects.edit("remove",'+JSON.stringify(projectId)+',"Research")')
          await wait(()=>run('Boolean(document.querySelector(".dshChatProjectForm"))'))
          await click('[role=dialog] button[type=submit]')
          await wait(()=>run('document.querySelectorAll("[data-chat-project]").length===0'))
          assert.equal(deleted.size,0,'Removing a project keeps all cloud conversations')
        }
        await run('fixture.navigation.projects.edit("create");fixture.navigation.projects.confirm("Persistent project")')
        projectId=await run('fixture.navigation.projects.snapshot().projects[0].id')
        await owner.loadFile(${JSON.stringify(join(dir,'index.html'))})
        await wait(()=>run('document.querySelectorAll("[data-chat-project]").length===1'))
        await click('[data-chat-project] .dshSidebarItemTools > button')
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
        await focusAgain()
        await wait(()=>run('document.querySelector("[data-chat-project]").textContent.includes("Renamed from Web")'))
        const syncLatencyMs=Date.now()-changedAt
        await run('fixture.navigation.projects.edit("rename",'+JSON.stringify(projectId)+',"Renamed from Web");fixture.navigation.projects.confirm("Renamed from Desktop")')
        const webSnapshot=await (await fetch(origin+'/api/v1/chat/projects/snapshot',{headers:{Cookie:'fixture=synthetic'}})).json()
        assert.equal(webSnapshot.data.projects[0].name,'Renamed from Desktop','Desktop changes are visible to a separate HTTP client')
        projects[0].name='Recovered after disconnect'
        await focusAgain()
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
          await key('Escape',27)
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
        const result={cases,projectCases:4,projectPersistence:true,serverMembership:true,bidirectionalSync:true,focusRefresh:true,olderProjectHistory:true,syncLatencyMs,deleted:deleted.size,attempts:[...attempts.values()],platform:process.platform,electron:process.versions.electron,scope:'production UI primitives, project/history controllers, native Chat view and authenticated loopback fixture; no production deployment'}
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
