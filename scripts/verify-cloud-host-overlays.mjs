import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { build } from 'esbuild'

// Offline native regression: production cloud controller, real SettingsPanel / Menu / Modal.
// Only the window bridge and loopback cloud service are fixtures. No account/profile is loaded.
const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const temporary = await mkdtemp(join(tmpdir(), 'dsh-cloud-overlays-'))
const buildOnly = process.argv.includes('--build-only')
const output = resolve(process.argv.slice(2).find(value => value !== '--build-only') || join(root, 'outputs/cloud-host-overlays'))
try {
  await mkdir(output, { recursive: true })
  const primitivePath = require.resolve('@deepseek-ai/dsh-client-ui-primitives')
  const primitives = await readFile(primitivePath, 'utf8')
  const boundary = primitives.indexOf('//#region lib/types/RiskConfirmation.js')
  assert.ok(boundary > 0, 'Installed primitives extraction boundary')
  const settings = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-settings-general/client'), 'utf8')
  const settingsCssStart = settings.indexOf('const css$7 = ')
  const settingsCssEnd = settings.indexOf('//#endregion', settingsCssStart)
  const settingsStart = settings.indexOf('function navIcon(')
  const settingsEnd = settings.indexOf('function SettingsRoot(')
  assert.ok(settingsCssStart > 0 && settingsCssEnd > settingsCssStart && settingsStart > 0 && settingsEnd > settingsStart, 'Installed SettingsPanel extraction boundaries')
  const settingsModule = `import * as react from 'react'; import * as react_dom from 'react-dom'; import * as react_jsx_runtime from 'react/jsx-runtime'; import * as _deepseek_ai_dsh_client_ui_primitives from 'fixture-primitives';
${settings.slice(settings.indexOf('function r(e)'), settingsCssStart)}
${settings.slice(settingsCssStart, settingsCssEnd)}
${settings.slice(settingsStart, settingsEnd)}
export {SettingsPanel};`
  const theme = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-theme/client'), 'utf8')
  const css = [...theme.matchAll(/var \w+_css_default = ("(?:[^"\\]|\\.)*");/g)].map(match => JSON.parse(match[1])).join('\n')
  const desktop = (await readFile(join(root, 'packages/dsh-desktop-client-ui/client.js'), 'utf8'))
    .replace('exports.apply = apply', 'exports.observeCloudHostOcclusion = observeCloudHostOcclusion; exports.apply = apply')
  assert.ok(desktop.includes('exports.observeCloudHostOcclusion ='), 'Export production cloud controller in memory')
  await build({ stdin: { resolveDir: root, contents: `
    import React from 'react'
    import {createRoot} from 'react-dom/client'
    import * as primitives from 'fixture-primitives'
    import {SettingsPanel} from 'fixture-settings'
    let helpers
    window.__ModuleLoader__={load({factory}){helpers=factory(name=>name==='react'?React:primitives)}}
    new Function(${JSON.stringify(desktop)})()
    window.dshDesktopEnterprise={captureCloudWorkbench:()=>window.bridge.capture(),setCloudHostOccluded:value=>window.bridge.occlude(value)}
    const stop=helpers.observeCloudHostOcclusion()
    const h=React.createElement
    let change,monitoring=false,frame,activeCase='',pending=[]
    const sample=()=>{
      if(!monitoring)return
      const el=document.querySelector('[role=dialog], [role=menu]')
      if(el){
        const rect=el.getBoundingClientRect(),style=getComputedStyle(el)
        pending.push(window.bridge.sample({case:activeCase,time:performance.now(),role:el.getAttribute('role'),opacity:Number(style.opacity),animation:style.animationName,visible:el.checkVisibility({checkVisibilityCSS:true,opacityProperty:true}),rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},backing:!!document.querySelector('[data-dsh-native-frame]')}))
      }
      frame=requestAnimationFrame(sample)
    }
    function App(){
      const [open,setOpen]=React.useState('')
      change=setOpen
      const close=()=>setOpen('')
      const slot=(name,props,options)=>name==='settings.header'?'Fixture settings':name==='settings.close'?'Close settings':name==='settings.navigation'?options.fallback:name==='settings.section'?h('button',{id:'settings-action',onClick:()=>window.hostClicks++},'Settings action'):null
      return h(React.Fragment,null,
        h('aside',null,
          ...['sidebar','cross'].map(kind=>h('div',{key:kind,id:kind},h(primitives.Menu,{open:open===kind,portal:true,align:'start',onClose:close,anchor:h('button',{id:kind+'-trigger',onClick:()=>setOpen(kind)},kind+' menu'),items:[{id:'selected',label:kind==='sidebar'?'Rename':'Move cloud workbench to project'}],onSelect:()=>{window.hostClicks++;close()}}))),
          h('button',{id:'settings-trigger',onClick:()=>setOpen('settings')},'Settings'),
          h('button',{id:'modal-trigger',onClick:()=>setOpen('modal')},'Modal')),
        h('section',{'data-dsh-cloud-surface':'fixture-cloud'}),
        open==='settings'&&h(SettingsPanel,{rows:[{id:'general',label:'General'}],actionItems:[],activeId:'general',renderSlot:slot,onSelect:()=>{},onClose:close}),
        h(primitives.Modal,{open:open==='modal',onClose:close,title:'Cloud host modal',closeLabel:'Close modal'},h('button',{id:'modal-action',onClick:()=>window.hostClicks++},'Modal action')))
    }
    window.hostClicks=0
    createRoot(document.getElementById('root')).render(h(App))
    window.fixture={start(name){activeCase=name;monitoring=true;pending=[];frame=requestAnimationFrame(sample)},async finish(){monitoring=false;cancelAnimationFrame(frame);await Promise.all(pending)},close:()=>change(''),dispose:()=>stop()}
  ` }, bundle: true, platform: 'browser', outfile: join(temporary, 'renderer.js'), loader: { '.css': 'local-css' }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'fixture-components', setup(build) {
    build.onResolve({ filter: /^clsx$/ }, () => ({ path: 'clsx', namespace: 'fixture-clsx' }))
    build.onLoad({ filter: /.*/, namespace: 'fixture-clsx' }, () => ({ contents: 'export default (...values) => values.flat(Infinity).filter(Boolean).join(" ")' }))
    build.onResolve({ filter: /^[^./]/, namespace: 'fixture' }, args => ['react', 'react-dom', 'react/jsx-runtime', 'clsx'].includes(args.path) ? undefined : ({ path: args.path, external: true, sideEffects: false }))
    build.onResolve({ filter: /^fixture-settings$/ }, () => ({ path: 'settings', namespace: 'fixture-settings' }))
    build.onLoad({ filter: /.*/, namespace: 'fixture-settings' }, () => ({ contents: settingsModule, resolveDir: root }))
    build.onResolve({ filter: /^fixture-primitives$/ }, () => ({ path: primitivePath, namespace: 'fixture' }))
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: primitives.slice(0, boundary) + '\nexport {Menu,Modal,useModalLayer,IconCloseOutlineRegular,IconSettingsOutlineMedium,IconUserOutlineMedium,IconDataOutlineMedium,IconAgentPresetOutlineMedium,IconPersonalizationOutlineMedium,IconArchiveOutlineMedium};', resolveDir: dirname(primitivePath) }))
  } }] })
  await writeFile(join(temporary, 'index.html'), `<!doctype html><html><meta charset="UTF-8"><link rel="stylesheet" href="renderer.css"><style>${css}
body{margin:0;font:14px sans-serif;background:var(--dsw-alias-bg-base)}#root{display:grid;grid-template-columns:320px 1fr;height:100vh}aside{padding:30px 10px}aside>button{display:block;margin-top:30px}#cross{margin:80px 0 20px 260px}[data-dsh-cloud-surface]{position:relative;min-width:0}</style><main id="root"></main><script src="renderer.js"></script></html>`)
  await writeFile(join(temporary, 'owner.cjs'), `const {contextBridge,ipcRenderer}=require("electron");contextBridge.exposeInMainWorld("bridge",{capture:()=>ipcRenderer.invoke("fixture:capture"),occlude:value=>ipcRenderer.invoke("fixture:occlude",value),sample:value=>ipcRenderer.invoke("fixture:sample",value)})`)
  const entry = join(temporary, 'main.mjs')
  await build({ stdin: { resolveDir: root, contents: `
    import assert from 'node:assert/strict'
    import {createServer} from 'node:http'
    import {writeFile} from 'node:fs/promises'
    import {app,BrowserWindow,ipcMain} from 'electron'
    import {CloudWorkbenchView} from './src/main/enterprise/cloud-workbench-view'
    app.setPath('userData',${JSON.stringify(join(temporary, 'profile'))})
    app.commandLine.appendSwitch('force-color-profile','srgb')
    app.whenReady().then(async()=>{
      const checks=[],samples=[],transitions=[]
      let captures=0,view,requests=0
      const check=(name,passed,detail)=>{checks.push({name,passed:!!passed,detail});console.log((passed?'PASS ':'FAIL ')+name)}
      const server=createServer((req,res)=>{
        if(req.url==='/launch'){res.writeHead(204,{'set-cookie':'fixture=synthetic; HttpOnly; SameSite=Lax; Path=/'});res.end();return}
        requests++;res.setHeader('content-type','text/html');res.end('<!doctype html><style>body{margin:0;background:rgb(22,183,173);height:100vh}input{margin:40px;width:300px}</style><input id="draft"><script>window.identity=Math.random();window.clicks=0;document.addEventListener("click",()=>window.clicks++)</script>')
      })
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
      const origin='http://127.0.0.1:'+server.address().port
      const owner=new BrowserWindow({show:true,width:1100,height:760,title:'Offline cloud overlay regression',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:${JSON.stringify(join(temporary, 'owner.cjs'))}}})
      const host=new CloudWorkbenchView()
      const attached=()=>!!view&&owner.contentView.children.includes(view)
      owner.webContents.on('console-message',event=>{if(event.level==='error')console.error('[renderer]',event.message)})
      owner.webContents.on('preload-error',(_event,...args)=>console.error('[preload]',...args))
      for(const method of ['capture','occlude','sample'])ipcMain.handle('fixture:'+method,async(event,value)=>{
        assert.equal(event.sender,owner.webContents);assert.equal(event.senderFrame,owner.webContents.mainFrame)
        if(method==='capture'){captures++;return host.capture(owner)}
        if(method==='occlude'){assert.equal(typeof value,'boolean');host.setHostOccluded(value);transitions.push({occluded:value,attached:attached(),time:Date.now()});return}
        samples.push({...value,attached:attached()})
      })
      const run=code=>owner.webContents.executeJavaScript(code)
      const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
      const wait=async(check,label)=>{for(let i=0;i<250;i++){if(await check())return;await delay(20)}throw new Error('Cloud overlay timed out: '+label)}
      const click=async(selector,native=false)=>{
        const wc=native?view.webContents:owner.webContents
        const p=await wc.executeJavaScript('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()')
        wc.sendInputEvent({type:'mouseMove',...p});wc.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:1});wc.sendInputEvent({type:'mouseUp',...p,button:'left',clickCount:1})
      }
      let error
      try{
        await owner.loadFile(${JSON.stringify(join(temporary, 'index.html'))})
        await wait(()=>run('!!document.querySelector("[data-dsh-cloud-surface]")'),'cloud seat mount')
        const bounds=await run('(()=>{const r=document.querySelector("section").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()')
        await host.open(owner,{appId:'fixture',slug:'fixture',launchUrl:origin+'/launch',entryUrl:origin+'/app/',ticket:'synthetic',connectionKey:'offline'},bounds,'fixture',()=> 'offline')
        view=owner.contentView.children.find(child=>child.webContents?.getURL().startsWith(origin))
        assert.ok(view,'Real CloudWorkbenchView attached')
        app.focus({steal:true});owner.focus()
        await wait(()=>owner.isFocused(),'active desktop window focus')
        await click('#draft',true);await view.webContents.insertText('cloud draft survives overlays')
        const identity=await view.webContents.executeJavaScript('window.identity')
        const initialRequests=requests
        for(const kind of ['sidebar','cross','settings','modal']){
          const before=captures,firstSample=samples.length
          await run('fixture.start('+JSON.stringify(kind)+')')
          await click('#'+kind+'-trigger')
          const selector=kind==='settings'?'[data-dsh-settings-section]':kind==='modal'?'[role=dialog]':'[role=menu]'
          await wait(()=>run('!!document.querySelector('+JSON.stringify(selector)+')'),kind+' DOM mount')
          if(kind==='sidebar'){
            await delay(200)
            const right=await run('document.querySelector("[role=menu]").getBoundingClientRect().right')
            check('sidebar menu does not intersect cloud',right<=bounds.x,{right,cloudX:bounds.x})
            check('nonintersecting sidebar keeps native attached',attached())
            check('nonintersecting sidebar does not capture',captures===before,{before,captures})
          }else{
            if(kind==='cross')check('cross menu intersects cloud',await run('document.querySelector("[role=menu]").getBoundingClientRect().right')>bounds.x)
            await wait(()=>!attached(),kind+' native detached')
            await wait(()=>run('!!document.querySelector("[data-dsh-native-frame]")'),kind+' screenshot backing')
            check(kind+' captures real native page',captures>before)
            const image=await owner.webContents.capturePage(),size=image.getSize(),bitmap=image.toBitmap()
            // Outside dialog/menu and mask blur, green must survive as a composited backing.
            const x=Math.floor(size.width-8),y=Math.floor(size.height-8),index=(y*size.width+x)*4
            const pixel=[...bitmap.subarray(index,index+4)]
            check(kind+' backing retains colored cloud pixels',pixel[1]>pixel[2]+20&&pixel[0]>pixel[2]+20,{pixel})
            await writeFile(${JSON.stringify(output)}+'/'+kind+'.png',image.toPNG())
            const hostBefore=await run('hostClicks')
            await click(kind==='cross'?'[role=menuitem]':'#'+kind+'-action')
            await wait(()=>run('hostClicks')===hostBefore+1,kind+' host receives native mouse input')
            check(kind+' host receives foreground input',true)
          }
          if(kind==='sidebar')await click('[role=menuitem]')
          else if(kind==='settings')await click('[data-dsh-settings-close]')
          else if(kind==='modal'){
            owner.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});owner.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
          }
          await wait(()=>attached()&&run('document.querySelector("[data-dsh-native-frame]")===null'),kind+' native restore and frame cleanup')
          await run('fixture.finish()')
          const frames=samples.slice(firstSample)
          check(kind+' samples real animation frames',frames.length>0,{frames:frames.length})
          if(kind==='settings')check('real SettingsPanel has no entry animation',frames.every(frame=>frame.animation==='none'))
          if(kind==='modal'){
            check('real primitives Modal animation sampled',frames.some(frame=>frame.animation!=='none'),{first:frames[0]})
            check('Modal initial zero-opacity frame observed',frames.some(frame=>frame.opacity===0),{first:frames[0]})
          }
          if(kind!=='sidebar')check(kind+' visible first paint yields native',!frames.some(frame=>frame.visible&&frame.attached),{coveredFrames:frames.filter(frame=>frame.visible&&frame.attached).length,first:frames[0]})
          check(kind+' preserves draft and document',await view.webContents.executeJavaScript('document.querySelector("#draft").value')==='cloud draft survives overlays'&&await view.webContents.executeJavaScript('window.identity')===identity)
          check(kind+' restores native attachment',attached())
        }
        check('overlays never reload cloud document',requests===initialRequests,{initialRequests,requests})
        check('host overlay clicks never reach cloud page',await view.webContents.executeJavaScript('window.clicks')===1)
        await run('fixture.dispose()')
      }catch(cause){error=String(cause?.stack||cause);console.error(cause)}finally{
        const result={platform:process.platform,electron:process.versions.electron,isolatedUserData:app.getPath('userData'),checks,captures,transitions,samples,error,passed:!error&&checks.every(check=>check.passed)}
        await writeFile(${JSON.stringify(output)}+'/result.json',JSON.stringify(result,null,2))
        console.log(JSON.stringify({passed:result.passed,checks:checks.length,failures:checks.filter(check=>!check.passed),error,captures}))
        host.close();owner.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
        app.exit(result.passed?0:1)
      }
    }).catch(error=>{console.error(error);app.exit(1)})
  ` }, bundle: true, platform: 'node', format: 'esm', external: ['electron'], outfile: entry })
  if (buildOnly) {
    console.log('Cloud overlay renderer and main bundles built; Electron was not started (--build-only).')
  } else {
  const env = { ...process.env, DSH_HOME: join(temporary, 'dsh-home') }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [entry], { env, stdio: ['ignore', 'pipe', 'pipe'], signal: AbortSignal.timeout(60_000) })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk) })
  child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk) })
  const status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })) })
  await writeFile(join(output, 'electron-process.json'), JSON.stringify({ ...status, stdout, stderr }, null, 2))
  console.log('Electron exit:', JSON.stringify(status))
  assert.equal(status.code, 0, 'Real Electron regression failed; inspect electron-process.json and result.json (if the renderer initialized)')
  }
} finally {
  // This mkdtemp directory belongs exclusively to this invocation, never a user profile.
  await rm(temporary, { recursive: true, force: true })
}
