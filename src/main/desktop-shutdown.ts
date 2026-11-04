type ShutdownName = 'runtime' | 'mobile' | 'extensions'

export async function settleDesktopShutdown(
  tasks: ReadonlyArray<{ name: ShutdownName, stop: () => void | Promise<void> }>
): Promise<Array<{ component: ShutdownName, category: 'aggregate' | 'error' }>> {
  const results = await Promise.allSettled(tasks.map((task) => Promise.resolve().then(task.stop)))
  const failures: Array<{ component: ShutdownName, category: 'aggregate' | 'error' }> = []
  results.forEach((result, index) => {
    const task = tasks[index]
    if (task && result.status === 'rejected') {
      failures.push({ component: task.name, category: result.reason instanceof AggregateError ? 'aggregate' : 'error' })
    }
  })
  return failures
}
