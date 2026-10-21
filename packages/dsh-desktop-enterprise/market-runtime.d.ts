import type { Context } from '@deepseek-ai/cordis'
import type { EnterpriseAuthHost } from './enterprise-auth.js'
export interface MarketRuntimeRecord { name: string; plugin_id?: string; directory: string; config?: Record<string, unknown> }
export interface MarketRuntimeFiber { dispose(): Promise<void>; readonly state?: number }
export declare function createMarketRuntime(ctx: Context, auth?: EnterpriseAuthHost): (record: MarketRuntimeRecord) => Promise<MarketRuntimeFiber>
