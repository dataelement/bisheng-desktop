import { writeFileSync } from 'node:fs'

writeFileSync(process.env.FIXTURE_REPORT, JSON.stringify({
  home: process.env.DSH_HOME, profile: process.env.DSH_DESKTOP_PROFILE,
  productName: process.env.DSH_DESKTOP_PRODUCT_NAME
}))
process.send?.({ type: 'ready', url: 'http://127.0.0.1:9/', injections: [] })
process.on('message', message => {
  if (message?.type === 'shutdown') {
    process.send?.({ type: 'shutdown-complete' }, () => process.exit(0))
  }
})
