/** Return a validated registry identifier, or throw EnterpriseAuthError(invalid_request). */
export declare function validateEnterpriseAppId(value: unknown): string
/** Block host-only integration credential routes, including encoded/normalized aliases. */
export declare function assertEnterprisePublicRequestPath(path: unknown): void
