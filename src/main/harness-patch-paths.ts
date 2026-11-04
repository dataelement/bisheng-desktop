export function resolveHarnessPatchPaths(
  patches: { normal: string; safe: string; market: string },
  resolveResource: (name: string) => string
) {
  return {
    dshPatchPath: resolveResource(patches.normal),
    dshSafePatchPath: resolveResource(patches.safe),
    dshMarketPatchPath: resolveResource(patches.market)
  }
}
