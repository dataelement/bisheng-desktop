delete process.env.ELECTRON_RUN_AS_NODE
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { packagedImportsPlugin } = require('./scripts/release/packaged-imports.cjs') as {
  packagedImportsPlugin(dependencies: Record<string, string>, preload?: boolean): import('rollup').Plugin
}
const { dependencies } = require('./package.json') as { dependencies: Record<string, string> }

// The official package is the transplanted shell. Host is a second main entry:
// electron-vite has no separate target, and this process is spawned with ELECTRON_RUN_AS_NODE.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), packagedImportsPlugin(dependencies)],
    build: {
      rollupOptions: {
        input: {
          index: resolve('packages/dsh-desktop-enterprise/desktop/main.ts'),
          host: resolve('src/host/index.ts'),
          'operation-report-worker': resolve('src/main/shell/operation-report-worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin(), packagedImportsPlugin(dependencies, true)],
    build: {
      rollupOptions: {
        input: {
          app: resolve('packages/dsh-desktop-enterprise/desktop/preload.ts'),
          'enterprise-chat': resolve('packages/dsh-desktop-enterprise/desktop/preload/enterprise-chat.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  }
})
