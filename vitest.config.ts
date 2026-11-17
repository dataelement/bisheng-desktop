import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.{test,spec}.{ts,js,mjs}'],
    // dsh-fs-local lives in node_modules. Inline it so the ASAR stat test can
    // replace node:fs/promises before probe() binds stat/lstat.
    server: {
      deps: {
        inline: ['@deepseek-ai/dsh-fs-local']
      }
    },
    // ARM64 and Rosetta x64 CI workers share the same Mac. Serialize files in
    // both jobs so ARM64 tests leave CPU and disk headroom for the Intel worker.
    // Windows integration suites also need serialization to avoid EBUSY locks.
    fileParallelism: !(
      process.env.CI &&
      (process.platform === 'darwin' || process.platform === 'win32')
    ),
    testTimeout: 60_000
  }
})
