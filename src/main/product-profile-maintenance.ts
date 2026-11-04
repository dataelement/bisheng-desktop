export type ProductProfileMaintenance = (context: {
  dshHome: string
  note: (line: string) => void
}) => Promise<void>

export async function runProductProfileMaintenance(
  maintenance: ProductProfileMaintenance,
  dshHome: string,
  note: (line: string) => void,
  refreshRecoveryLock: () => Promise<unknown>
): Promise<void> {
  await refreshRecoveryLock()
  await maintenance({ dshHome, note })
}
