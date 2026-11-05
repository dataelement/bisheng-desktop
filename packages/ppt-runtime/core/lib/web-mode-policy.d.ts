import type { Context } from '@deepseek-ai/cordis'

/** Session-mode view exposed by the PPT core service. */
export interface WebPptModes {
  state(id: string): Promise<{ presentationMode?: string }>
}

/** Register per-agent Web workflow policy; returns idempotent teardown. */
export declare function installWebModePolicy(ctx: Context, modes: WebPptModes): () => void
