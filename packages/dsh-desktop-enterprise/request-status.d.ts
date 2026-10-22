/** Reports successful HTTP responses only after complete consumption, without buffering. */
export declare function observeRequestResponse(response: Response, signal: AbortSignal, settle: (error?: unknown) => void): Response
