import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['packages/dsh-desktop-enterprise/desktop/mobile/*.test.ts'] } })
