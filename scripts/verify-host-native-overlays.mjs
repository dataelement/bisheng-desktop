import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { build } from 'esbuild'

// Production overlay coordinator + Harness primitives above a real native enterprise view.
// No real account or existing userData is read; run separately on each target platform.
const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const temporary = await mkdtemp(join(tmpdir(), 'dsh-host-overlays-'))
const output = resolve(process.argv[2] || 'outputs/host-native-overlays')
try {
  await mkdir(output, { recursive: true })
  const primitivePath = require.resolve('@deepseek-ai/dsh-client-ui-primitives')
  const primitives = await readFile(primitivePath, 'utf8')
  const boundary = primitives.indexOf('//#region lib/types/RiskConfirmation.js')
  assert.ok(boundary > 0)
  const theme = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-theme/client'), 'utf8')
  const css = [...theme.matchAll(/var \w+_css_default = ("(?:[^"\\]|\\.)*");/g)].map(match => JSON.parse(match[1])).join('\n')
  const desktop = (await readFile(join(root, 'packages/dsh-desktop-client-ui/client.js'), 'utf8'))
    .replace('exports.apply = apply', 'exports.observeHostOverlays = observeHostOverlays; exports.createNativeSurfacePresenter = createNativeSurfacePresenter; exports.observeNativeSurfaceIntent = observeNativeSurfaceIntent; exports.apply = apply')
  await build({ stdin: { resolveDir: root, contents: `
    import React from 'react'
    import {createRoot} from 'react-dom/client'
    import * as primitives from 'fixture-primitives'
    let helpers
    window.__ModuleLoader__ = {load({factory}) { helpers = factory(name => name === 'react' ? React : primitives) }}
    new Function(${JSON.stringify(desktop)})()
    const App = () => {
      const [open,setOpen] = React.useState(false)
      React.useEffect(()=>window.fixture.present(),[])
      return React.createElement(React.Fragment,null,
        React.createElement('aside',null,React.createElement(primitives.Menu,{
          open,portal:true,align:'start',onClose:()=>setOpen(false),
          anchor:React.createElement('button',{id:'trigger',onClick:()=>{window.menuOpenedAt=performance.now();window.menuYieldedAt=undefined;setOpen(value=>!value)}},'Menu'),
          items:[{id:'rename',label:'Rename session / 重命名会话'},{id:'project',label:'Move to project',submenu:[{id:'team',label:'Team project'}]}],
          onSelect:id=>{window.selected=id;setOpen(false)}
        })), React.createElement('section',{'data-dsh-native-surface':''}))
    }
    createRoot(document.getElementById('root')).render(React.createElement(App))
    window.selected=''
    let presenter, overlays, intentEnabled=true, monitoring=false, paintFrame, samples=[]
    window.nativeVisible=true
    const bridge={...window.bridge,present:async value=>{const result=await window.bridge.present(value);window.nativeVisible=value.visible;if(!value.visible&&window.menuYieldedAt===undefined&&document.querySelector('[role=menu]'))window.menuYieldedAt=performance.now();return result}}
    const present = () => {
      const seat=document.querySelector('[data-dsh-native-surface]');if(!seat)return
      const r=seat.getBoundingClientRect(),bounds={x:r.x,y:r.y,width:r.width,height:r.height}
      presenter.present({visible:!overlays.isModal(),bounds,theme:document.body.hasAttribute('data-ds-dark-theme')?'dark':'light'},overlays.intersects(bounds),()=>overlays.defer(bounds))
    }
    presenter=helpers.createNativeSurfacePresenter(bridge,()=>document.querySelector('[data-dsh-native-surface]'))
    overlays=helpers.observeHostOverlays(present)
    new ResizeObserver(present).observe(document.getElementById('root'))
    window.addEventListener('resize',present)
    const stopIntent=helpers.observeNativeSurfaceIntent(()=>{if(intentEnabled)void presenter.warm()})
    const sample=()=>{
      if(!monitoring)return
      const visible=[...document.querySelectorAll('[role=menu]')].some(menu=>menu.checkVisibility({checkVisibilityCSS:true,opacityProperty:true}))
      samples.push({visible,nativeVisible:window.nativeVisible})
      paintFrame=requestAnimationFrame(sample)
    }
    window.fixture={present,warm:()=>presenter.warm(),startPaints(enabled){intentEnabled=enabled;samples=[];monitoring=true;paintFrame=requestAnimationFrame(sample)},stopPaints(){monitoring=false;cancelAnimationFrame(paintFrame);return samples},dispose(){monitoring=false;cancelAnimationFrame(paintFrame);stopIntent();overlays.dispose();presenter.dispose()}}
  ` }, bundle: true, platform: 'browser', outfile: join(temporary, 'renderer.js'), loader: { '.css': 'local-css' }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'primitives', setup(build) {
    build.onResolve({ filter: /^clsx$/ }, () => ({ path: 'clsx', namespace: 'fixture-clsx' }))
    build.onLoad({ filter: /.*/, namespace: 'fixture-clsx' }, () => ({ contents: 'export default (...values) => values.filter(Boolean).join(" ")' }))
    build.onResolve({ filter: /^[^./]/, namespace: 'fixture' }, args => ['react', 'react-dom', 'react/jsx-runtime', 'clsx'].includes(args.path) ? undefined : ({ path: args.path, external: true, sideEffects: false }))
    build.onResolve({ filter: /^fixture-primitives$/ }, () => ({ path: primitivePath, namespace: 'fixture' }))
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: primitives.slice(0, boundary) + '\nexport {Menu};', resolveDir: dirname(primitivePath) }))
  } }] })
  await writeFile(join(temporary, 'index.html'), `<!doctype html><html><meta charset="UTF-8"><link rel="stylesheet" href="renderer.css"><style>${css}
    body{margin:0;font:14px sans-serif;background:var(--dsw-alias-bg-base)}#root{display:grid;grid-template-columns:260px 1fr;height:100vh}
    aside{padding:100px 0 0 210px}[data-dsh-native-surface]{position:relative;min-width:0}
    </style><main id="root"></main><script src="renderer.js"></script></html>`)
  await writeFile(join(temporary, 'owner.cjs'), `
    const {contextBridge,ipcRenderer}=require('electron')
    contextBridge.exposeInMainWorld('bridge',{present:value=>ipcRenderer.invoke('fixture:present',value),capture:()=>ipcRenderer.invoke('fixture:capture')})
  `)
  await build({ entryPoints: [join(root, 'src/preload/enterprise-chat.ts')], outfile: join(temporary, 'preload/enterprise-chat.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
  const entry = join(temporary, 'main/main.mjs')
  await build({ stdin: { resolveDir: root, contents: `
    import assert from 'node:assert/strict'
    import {createServer} from 'node:http'
    import {writeFile} from 'node:fs/promises'
    import {app,BrowserWindow,ipcMain} from 'electron'
    import {EnterpriseChatView} from './src/main/enterprise/chat-view'
    app.setPath('userData',${JSON.stringify(join(temporary, 'profile'))})
    app.commandLine.appendSwitch('force-color-profile','srgb')
    app.whenReady().then(async()=>{
      const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><style>body{margin:0}.page{height:100vh;background:rgb(22,183,173)}</style><main id="root"><div class="page"><button onclick="window.clicks++">Embedded page</button></div></main><script>window.clicks=0</script>')})
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
      const origin='http://127.0.0.1:'+server.address().port
      const owner=new BrowserWindow({show:true,width:1000,height:700,title:'Native overlay verification',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:${JSON.stringify(join(temporary, 'owner.cjs'))}}})
      owner.webContents.on('console-message',event=>{if(event.level==='error')console.error('[renderer]',event.message)})
      owner.webContents.on('preload-error',(_event,...args)=>console.log('[preload]',...args))
      const host=new EnterpriseChatView({snapshot:()=>({connected:true,connectionKey:'fixture'}),subscribe:()=>()=>{},webSession:async()=>({base:origin,cookieName:'fixture',cookie:'synthetic',expiresAt:Date.now()+300000})},console.log)
      let captures=0
      for(const method of ['present','capture'])ipcMain.handle('fixture:'+method,async(event,value)=>{
        assert.equal(event.sender,owner.webContents);assert.equal(event.senderFrame,owner.webContents.mainFrame)
        if(method==='capture')captures++
        if(method==='present')return host.present(owner,value)
        const frame=await host.capture(owner)
        // A cold capture must never expose a clipped first menu frame, even on slow machines.
        await new Promise(resolve=>setTimeout(resolve,80))
        return frame
      })
      const run=code=>owner.webContents.executeJavaScript(code)
      const wait=async (check,label='condition')=>{for(let i=0;i<200;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,20))}throw new Error('Native overlay timed out: '+label)}
      const point=async selector=>run('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()')
      const click=async selector=>{
        const p=await point(selector),zoom=owner.webContents.getZoomFactor(),x=Math.round(p.x*zoom),y=Math.round(p.y*zoom)
        owner.webContents.sendInputEvent({type:'mouseMove',x,y})
        owner.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1})
        owner.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1})
      }
      const results=[]
      try{
        await owner.loadFile(${JSON.stringify(join(temporary, 'index.html'))})
        await wait(()=>host.snapshot().phase==='ready','initial native ready')
        const view=owner.contentView.children.find(child=>child.webContents?.getURL().startsWith(origin)),wc=view.webContents
        app.focus({steal:true});owner.focus()
        await wait(()=>owner.isFocused(),'test window focus (an active desktop session is required)')
        for(const route of ['c/new','knowledge'])for(const width of [850,1100])for(const zoom of [0.8,1.25])for(const dark of [false,true]){
          owner.setSize(width,700);owner.webContents.setZoomFactor(zoom)
          await wc.loadURL(origin+'/workspace/'+route)
          await run('document.body.toggleAttribute("data-ds-dark-theme",'+dark+');fixture.present()')
          await wait(()=>view.getVisible())
          await new Promise(resolve=>setTimeout(resolve,100))
          const previous=captures
          await run('fixture.startPaints('+dark+')')
          if(dark)await run('fixture.warm()')
          await click('#trigger')
          await wait(()=>!view.getVisible(),'native hidden for menu')
          await wait(()=>run('Boolean(document.querySelector("[data-dsh-native-frame]"))'),'backing image')
          const handoffMs=await run('menuYieldedAt-menuOpenedAt')
          assert.ok(Number.isFinite(handoffMs)&&handoffMs>=0,'The menu handoff has a completed timing sample')
          assert.ok(await run('document.querySelector("[role=menu]").getBoundingClientRect().right>document.querySelector("section").getBoundingClientRect().left'),'Menu crosses the actual native boundary')
          const image=await owner.webContents.capturePage(),size=image.getSize(),bitmap=image.toBitmap()
          const i=(Math.floor(size.height*0.8)*size.width+Math.floor(size.width*0.8))*4
          // Native capture -> PNG -> compositor can quantize the same sRGB color by
          // a few levels. This still rejects blank/host-colored backing frames.
          const pixel=[...bitmap.subarray(i,i+4)],expected=[173,183,22,255]
          assert.ok(pixel.every((channel,index)=>Math.abs(channel-expected[index])<=3),'Page backing stays visible behind host overlays: '+pixel)
          await click('[role=menuitem][aria-haspopup=menu]')
          await wait(()=>run('document.querySelectorAll("[role=menu]").length===2'))
          assert.equal(view.getVisible(),false,'Native input stays suspended for the submenu')
          assert.equal(captures,previous+1,'Nested overlays reuse one frame')
          const option=await point('[role=menu] [role=menu] [role=menuitem]')
          assert.ok(option.x>260,'Submenu click is inside the embedded region')
          await click('[role=menu] [role=menu] [role=menuitem]')
          await wait(()=>run('selected==="team" && document.querySelector("[role=menu]")===null'))
          await wait(()=>view.getVisible())
          await wait(()=>run('document.querySelector("[data-dsh-native-frame]")===null'))
          const paints=await run('fixture.stopPaints()')
          assert.ok(paints.length>0,'The host actually painted during the handoff')
          assert.equal(paints.some(frame=>frame.visible&&frame.nativeVisible),false,'No menu paints while the native view still covers it')
          assert.equal(wc.isDestroyed(),false)
          assert.equal(await wc.executeJavaScript('window.clicks'),0,'Menu clicks never reach the embedded page')
          await click('#trigger');await wait(()=>!view.getVisible())
          owner.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});owner.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
          await wait(()=>view.getVisible())
          if(results.length===0)await writeFile(${JSON.stringify(join(output, 'menu.png'))},image.toPNG())
          results.push({route,width,zoom,dark,prewarmed:dark,handoffMs})
        }
        await run('fixture.dispose()')
        const result={platform:process.platform,electron:process.versions.electron,cases:results.length,captures,checks:['cold and prepared first-paint handoff','cross-boundary menu pixels','native mouse dispatch','nested menus','page backing pixels','Escape','same remote document','frame cleanup'],results}
        await writeFile(${JSON.stringify(join(output, 'result.json'))},JSON.stringify(result,null,2))
        console.log(JSON.stringify(result))
      }finally{host.dispose();owner.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
      app.exit(0)
    }).catch(error=>{console.error(error);app.exit(1)})
  ` }, bundle: true, platform: 'node', format: 'esm', external: ['electron'], outfile: entry })
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(require('electron'), [entry], { env, stdio: 'inherit', signal: AbortSignal.timeout(60_000) })
  assert.equal(await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) }), 0)
} finally { await rm(temporary, { recursive: true, force: true }) }
