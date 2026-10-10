import { useStore, type Page } from '../store'
import { Changes, Alerts, Feed } from './Lists'
import Ship from './Ship'

// Landing page: a slice of each list, with a link through to the full page.
export default function Overview() {
  return (
    <div className="flex min-h-full flex-col">
      <Ship />
      <div className="flex-1 bg-[var(--water-deep)]">
        <div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
          <Section title="Open alerts" page="alerts"><Alerts openOnly limit={3} /></Section>
          <Section title="Pending changes" page="changes"><Changes pendingOnly limit={3} /></Section>
          <Section title="Recent activity" page="feed"><Feed limit={10} /></Section>
        </div>
      </div>
    </div>
  )
}

export function Section({ title, page, children }: { title: string; page?: Page; children: React.ReactNode }) {
  const setPage = useStore((s) => s.setPage)
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-canvas">
      <div className="flex items-center border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {page && <button onClick={() => setPage(page)} className="ml-auto text-xs text-muted hover:text-fg">View all</button>}
      </div>
      {children}
    </section>
  )
}
