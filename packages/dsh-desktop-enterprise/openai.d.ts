import { LlmAdapter, type GenerateOptions, type LlmModelInfo, type LlmProviderInfo, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { EnterpriseModel } from './contract.js'

export type EnterpriseAdapterModel = Pick<EnterpriseModel, 'id' | 'display_name' | 'reasoning' | 'capabilities'>
export interface EnterpriseAdapterOptions {
  logger?: { debug(format: string, ...args: unknown[]): void }
  models(): readonly EnterpriseAdapterModel[]
  providerName?(): string
  connectionKey?(): string | undefined
  request(body: Record<string, unknown>, signal?: AbortSignal, headers?: Record<string, string>): Promise<Response>
  requestResponses?(body: Record<string, unknown>, signal: AbortSignal, headers: Record<string, string>, connectionKey: string): Promise<Response>
  readImage?(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<{ data: Uint8Array; mediaType: string } | undefined>
  onComplete?(model: string): void | Promise<void>
  onReplayDegrade?(reason: 'version' | 'account' | 'model' | 'content'): void
}

export declare const ALLOWED_ATTRIBUTION_HEADERS: readonly string[]
export declare function pickAttributionHeaders(headers?: Record<string, string>): Record<string, string>
export declare function serializeEnterpriseRequest(options: Omit<GenerateOptions, 'provider'> & { provider?: string }, model: EnterpriseAdapterModel, images?: ReadonlyMap<string, { url: string }>): Record<string, unknown>
export declare function parseSseEvents(body: ReadableStream<Uint8Array> | null, signal?: AbortSignal, limits?: { event: number; total: number }): AsyncGenerator<{ event: string; data: string }>
export declare function responseFailure(response: Response, localizeContentSafety?: (code: string, defaultMessage: string) => string, logger?: EnterpriseAdapterOptions['logger']): Promise<Error>
export declare function projectEnterpriseMessagesForTextModel(messages: GenerateOptions['messages']): GenerateOptions['messages']
export declare class EnterpriseLlmAdapter extends LlmAdapter {
  constructor(options: EnterpriseAdapterOptions)
  providerInfo(provider: string): LlmProviderInfo
  listModels(provider: string): Promise<readonly LlmModelInfo[]>
  resolveModel(provider: string, id: string): Promise<LlmResolvedModelInfo>
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}
