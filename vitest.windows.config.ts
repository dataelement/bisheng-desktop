import { defineConfig } from 'vitest/config'
import baseConfig from './vitest.config'

// Keep Windows coverage focused on the Web runtime, package installation,
// plugin imports, and workbench navigation. Electron-only suites were removed.
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    // Do not parallelize integration files: Windows subprocesses and archive
    // extraction can contend for locked files even with separate test workers.
    fileParallelism: false,
    include: [
      'test/stage-windows-web-runtime.test.mjs',
      'test/web-*.test.mjs',
      'test/enterprise-community-package.test.ts',
      'test/enterprise-proxy.test.mjs',
      'test/pack-enterprise-plugin.test.ts',
      'test/pack-office-web.test.mjs',
      'test/pack-ppt-web.test.mjs',
      'test/local-workbench-path.test.mjs',
      'test/workbench-*.test.mjs',
      'test/patch-runtime-compatibility.test.mjs'
    ]
  }
})
