import type { Context } from '@deepseek-ai/cordis'
export const name: 'desktop-office-web'
export const inject: string[]
export interface Config { root: string }
export function apply(ctx: Context, config: Config): Promise<void>
