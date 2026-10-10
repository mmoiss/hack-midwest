import type { Alert, FileEntry } from './store.ts'

export function alertFiles(alert: Alert): string[] {
  return [...new Set([...(alert.owner ? [alert.owner] : []), ...(alert.consumers ?? []), ...alert.files])]
}

// Keep historical alert paths available even if the current spec has since changed.
export function withAlertFiles(files: FileEntry[], alerts: Alert[]): FileEntry[] {
  const entries = new Map(files.map((f) => [f.path, new Set(f.deps)]))
  for (const alert of alerts) {
    for (const path of alertFiles(alert)) if (!entries.has(path)) entries.set(path, new Set())
    if (alert.owner) for (const consumer of alert.consumers ?? []) entries.get(consumer)!.add(alert.owner)
  }
  return [...entries].map(([path, deps]) => ({ path, deps: [...deps] }))
}

export function edgeAlerts(alerts: Alert[], owner: string, consumer: string): Alert[] {
  return alerts.filter((a) => a.status === 'open' && a.owner === owner && a.consumers?.includes(consumer))
}
