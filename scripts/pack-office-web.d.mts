export interface OfficeWebOptions { projectRoot?: string; outputRoot?: string; target?: string }
export function packOfficeWebArchive(result: { packageDirectory: string; outputRoot: string }, options?: { npmCli?: string }): Promise<{ outputFile: string; size: number; integrity: string }>
export function prepareOfficeWebPackage(options?: OfficeWebOptions): Promise<{ packageDirectory: string; outputRoot: string; templateCount: number }>
