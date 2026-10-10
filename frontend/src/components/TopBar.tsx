import { useStore } from '../store'
import Logo from './Logo'

export default function TopBar() {
  const { theme, toggleTheme } = useStore()
  return (
    <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-5">
      <Logo size={32} />
      <span className="text-xl font-semibold tracking-tight text-[#7a9a6e]">skeg</span>
      <button
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
        className="ml-auto flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-fg"
      >
        {theme === 'dark' ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
        )}
      </button>
    </header>
  )
}
