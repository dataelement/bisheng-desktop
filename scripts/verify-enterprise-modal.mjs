import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

// Native view/IPC regression with local semantic portal fixtures and an isolated profile.
// Run on Windows for platform acceptance; other hosts report their actual platform.
const root = resolve(import.meta.dirname, '..')
const output = resolve(process.argv[2] || 'outputs/enterprise-modal')
const temporary = await mkdtemp(join(tmpdir(), 'dsh-modal-'))
await mkdir(output, { recursive: true })
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#fff;color:#222;font:15px sans-serif}
#root{height:100vh;background:#fff;padding:30px}button{padding:8px 20px;margin:8px}
.mask{position:fixed;inset:0;background:transparent;z-index:100}
[role=dialog],[role=alertdialog]{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,90vw);background:white;padding:24px;border-radius:12px;z-index:101;box-shadow:0 5px 18px #0003}
.seat-probe,.modal-probe{position:absolute;width:8px;height:8px;pointer-events:none}.seat-probe{left:12px;top:12px;background:#06d6a0}.modal-probe{left:0;top:0;background:#ff0055}
.paint-tick{position:absolute;right:0;bottom:0;width:1px;height:1px;animation:paint-tick 100ms linear infinite alternate}@keyframes paint-tick{from{background:#000}to{background:#fff}}
</style></head><body><main id="root"><i class="seat-probe"></i><i class="paint-tick"></i><h2>Tools and skills · local fixture</h2><button id="upload">Upload skill</button><p>The page keeps its original content bounds.</p></main><script>
window.maskClicks=0;window.pageClicks=0;
document.querySelector('#upload').onclick=()=>openModal();
document.querySelector('#root').onclick=()=>window.pageClicks++;
window.openModal=(nested=false)=>{const portal=document.createElement('section');portal.className='portal';
portal.innerHTML='<div class="mask dsh-knowledge-overlay"></div><div role="'+(nested?'alertdialog':'dialog')+'" aria-modal="true" data-state="open"><i class="modal-probe"></i><h3>'+(nested?'Confirm action':'Upload skill')+'</h3><p>Local presentation fixture</p><button class="close">Cancel</button><button class="nested">Confirm</button></div>';
document.body.append(portal);portal.querySelector('.close').onclick=()=>portal.remove();portal.querySelector('.nested').onclick=()=>openModal(true);
portal.querySelector('.mask').onclick=()=>{window.maskClicks++;portal.remove()};portal.querySelector('.close').focus()};
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('.portal:last-child')?.remove()});
</script></body></html>`
try {
  await build({ entryPoints: [join(root, 'src/preload/enterprise-chat.ts')], outfile: join(temporary, 'preload/enterprise-chat.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] })
  await build({ stdin: { contents: `
    import assert from 'node:assert/strict'
    import { createServer } from 'node:http'
    import { writeFile } from 'node:fs/promises'
    import { app, BrowserWindow, webContents } from 'electron'
    import { EnterpriseChatView } from './src/main/enterprise/chat-view'
    app.setPath('userData', ${JSON.stringify(join(temporary, 'profile'))})
    const pause = () => new Promise(r => setTimeout(r, 30))
    async function until(check) { for(let i=0;i<150;i++){if(await check())return;await pause()}throw new Error('Presentation timed out: '+check.toString()) }
    function probes(image) {
      const size=image.getSize(), bitmap=image.toBitmap(), found={}
      for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++){
        const i=(y*size.width+x)*4
        if(bitmap[i+3]!==255)continue
        // Capture color management and bitmap channel order differ across platforms.
        const low=Math.min(bitmap[i],bitmap[i+2]), high=Math.max(bitmap[i],bitmap[i+2]), green=bitmap[i+1]
        const key=green>180&&green>high+20&&low<150?'seat':green<120&&high>180&&low<140?'modal':undefined
        if(key&&!found[key])found[key]={x,y}
      }
      return {size,...found}
    }
    app.whenReady().then(async()=>{
      const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(${JSON.stringify(html)})})
      await new Promise(r=>server.listen(0,'127.0.0.1',r))
      const base='http://127.0.0.1:'+server.address().port
      const window=new BrowserWindow({width:1084,height:998,show:true,alwaysOnTop:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
      if(process.platform==='darwin'){
        window.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true})
        app.show()
      }
      window.focus()
      app.focus({steal:true})
      await window.loadURL('data:text/html,'+encodeURIComponent('<body style="margin:0;background:#f6f7f8;font:15px sans-serif"><aside style="width:280px;padding:40px 20px">Conversation list<button onclick="window.sidebarClicks++">New conversation</button></aside><script>window.sidebarClicks=0</script>'))
      const enterprise={snapshot:()=>({connected:true,connectionKey:'fixture'}),subscribe:()=>()=>{},webSession:async()=>({base,cookieName:'fixture',cookie:'fixture',expiresAt:Date.now()+300000})}
      const host=new EnterpriseChatView(enterprise,line=>{if(line.includes('failed'))console.error(line)})
      const results=[]
      const delayed=new WeakSet()
      try {
        for(const size of [900,1084])for(const zoom of [0.8,1,1.25])for(const theme of ['light','dark']){
          window.setSize(size,998)
          window.webContents.setZoomFactor(zoom)
          const [width,height]=window.getContentSize()
          const bounds={x:280/zoom,y:40/zoom,width:(width-280)/zoom,height:(height-40)/zoom}
          const presentation={visible:true,theme,bounds}
          host.present(window,presentation)
          await until(()=>host.snapshot().phase==='ready')
          const wc=webContents.getAllWebContents().find(w=>w!==window.webContents&&w.getURL().startsWith(base))
          assert.ok(wc)
          if(!delayed.has(wc)){
            const execute=wc.executeJavaScript.bind(wc)
            // Exercise a busy renderer: modal transitions must not depend on this async delivery.
            wc.executeJavaScript=async(script,...args)=>{
              if(script.includes('dsh-window-dialog-viewport'))await new Promise(resolve=>setTimeout(resolve,50))
              return execute(script,...args)
            }
            delayed.add(wc)
          }
          // Keep this isolated capture fixture rendering when another app occludes its window.
          wc.setBackgroundThrottling(false)
          wc.setZoomFactor(zoom)
          await wc.loadURL(base+'/workspace/capabilities')
          await until(()=>host.snapshot().phase==='ready')
          host.present(window,presentation)
          const view=window.contentView.children[0]
          const region={x:280,y:40,width:width-280,height:height-40}
          assert.deepEqual(view.getBounds(),region)
          await until(()=>wc.executeJavaScript('document.documentElement.dataset.dshChatViewport==="ready"'))
          const before=await wc.executeJavaScript('JSON.stringify(document.querySelector("#root").getBoundingClientRect())')
          const frames=[]
          wc.beginFrameSubscription(image=>frames.push(probes(image)))
          await wc.executeJavaScript('openModal()')
          try { await until(()=>view.getBounds().x===0) } catch(error) {
            console.error('Modal state', {windowVisible:window.isVisible(),viewVisible:view.getVisible(),bounds:view.getBounds()},await wc.executeJavaScript('({hidden:document.hidden,marked:document.documentElement.hasAttribute("data-dsh-modal-open"),dialog:!!document.querySelector("[role=dialog]"),visible:document.querySelector("[role=dialog]")?.checkVisibility({checkVisibilityCSS:true})})'))
            throw error
          }
          assert.deepEqual(view.getBounds(),{x:0,y:0,width,height})
          assert.equal(await window.webContents.executeJavaScript('!!document.querySelector("#dsh-chat-dialog-backing")?.complete'),true)
          // This is the actual owner layer exposed if the native compositor drops its child frame.
          const backingFrame=probes(await window.webContents.capturePage())
          assert.ok(backingFrame.seat,'Native-frame loss would expose an empty owner surface')
          const backingScale=backingFrame.size.width/width
          assert.ok(Math.abs(backingFrame.seat.x/backingScale-(280+12*zoom))<1)
          assert.ok(Math.abs(backingFrame.seat.y/backingScale-(40+12*zoom))<1)
          const geometry=await wc.executeJavaScript('(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return {root:rect("#root"),mask:rect(".mask"),dialog:rect("[role=dialog]"),hit:document.elementFromPoint(30,100).className}})()')
          const close=(a,b)=>assert.ok(Math.abs(a-b)<1, a+' != '+b)
          close(geometry.root.x*zoom,280);close(geometry.root.y*zoom,40)
          close(geometry.root.width,JSON.parse(before).width);close(geometry.root.height,JSON.parse(before).height)
          close(geometry.mask.width*zoom,width);close(geometry.mask.height*zoom,height)
          close((geometry.dialog.x+geometry.dialog.width/2)*zoom,width/2)
          assert.equal(geometry.hit,'mask dsh-knowledge-overlay')
          assert.equal(await wc.executeJavaScript('getComputedStyle(document.querySelector(".mask")).backgroundColor'), 'rgba(0, 0, 0, 0)')
          try { await until(()=>frames.some(frame=>frame.modal)) } catch(error) {
            const image=await wc.capturePage()
            await writeFile(${JSON.stringify(join(output, 'failed-modal.png'))},image.toPNG())
            console.error('Captured frames',JSON.stringify(frames))
            throw error
          }
          await wc.executeJavaScript('openModal(true)')
          await wc.executeJavaScript('document.querySelector(".portal:last-child").remove()')
          await pause();assert.equal(view.getBounds().x,0)
          if(size===1084&&zoom===1&&theme==='light')await writeFile(${JSON.stringify(join(output, 'window-modal.png'))},(await wc.capturePage()).toPNG())
          wc.sendInputEvent({type:'mouseDown',x:30,y:100,button:'left',clickCount:1})
          wc.sendInputEvent({type:'mouseUp',x:30,y:100,button:'left',clickCount:1})
          await until(()=>view.getBounds().x===280)
          assert.equal(await wc.executeJavaScript('window.maskClicks'),1)
          assert.equal(await window.webContents.executeJavaScript('window.sidebarClicks'),0)
          await wc.executeJavaScript('openModal()');await until(()=>view.getBounds().x===0)
          wc.sendInputEvent({type:'keyDown',keyCode:'Escape'});wc.sendInputEvent({type:'keyUp',keyCode:'Escape'})
          await until(()=>view.getBounds().x===280)
          assert.deepEqual(view.getBounds(),region)
          await until(()=>window.webContents.executeJavaScript('!document.querySelector("#dsh-chat-dialog-backing")'))
          await pause()
          wc.endFrameSubscription()
          for(const frame of frames){
            const full=Math.abs(frame.size.width/frame.size.height-width/height)<0.005
            const native=full?{x:0,y:0,width,height}:region
            const scale=frame.size.width/native.width
            assert.ok(frame.seat,'Content seat disappeared during modal transition')
            close(native.x+frame.seat.x/scale,280+12*zoom)
            close(native.y+frame.seat.y/scale,40+12*zoom)
            if(frame.modal){
              assert.ok(full,'Modal painted before native window expansion')
              close(frame.modal.x/scale,(width-560*zoom)/2)
            }
          }
          results.push({size,zoom,theme,geometry,frames});console.log('PASS native portal frames='+frames.length+' width='+size+' zoom='+zoom+' theme='+theme)
        }
        await writeFile(${JSON.stringify(join(output, 'native-results.json'))},JSON.stringify({platform:process.platform,electron:process.versions.electron,fixture:'local semantic body portals',viewportDeliveryDelayMs:50,results},null,2))
      }finally{host.dispose();window.destroy();server.close()}
      app.exit(0)
    }).catch(error=>{console.error(error);app.exit(1)})
  `, resolveDir: root, loader: 'ts' }, outfile: join(temporary, 'main/index.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], define: { 'import.meta.dirname': '__dirname' } })
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(createRequire(import.meta.url)('electron'), [join(temporary, 'main/index.cjs')], { env, stdio: 'inherit', signal: AbortSignal.timeout(60_000) })
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
  assert.equal(code, 0, 'Native modal verification failed')
} finally { await rm(temporary, { recursive: true, force: true }) }
