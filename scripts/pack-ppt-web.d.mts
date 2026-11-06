export interface PptWebPackageOptions {
  /** Repository/fixture root. Defaults to cwd. */
  projectRoot?: string
  /** Generated package staging root, resolved against projectRoot. */
  stagingRoot?: string
  /** Separate output beneath projectRoot/.build. */
  outputRoot?: string
}

/** Prepare the local Web experiment directory without installing, publishing, or writing Profiles. */
export function preparePptWebPackage(options?: PptWebPackageOptions): Promise<{
  packageDirectory: string
  outputRoot: string
  templateCount: number
}>
