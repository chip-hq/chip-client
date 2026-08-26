import { useState, useRef, useEffect } from 'react'
import type { User } from 'firebase/auth'
import chipLogo from '../assets/ChipLogo.png'

export type TabType = 'dashboard' | 'manual' | 'history' | 'setup'

interface SidebarProps {
  user: User
  currentTab: TabType
  onSelectTab: (tab: TabType) => void
  onSignOut: () => void
  onOpenSettings?: () => void
  cloudConnected: boolean
  agentConnected?: boolean
  isMobileOpen: boolean
  setIsMobileOpen: (open: boolean) => void
}

export function Sidebar({
  user,
  currentTab,
  onSelectTab,
  onSignOut,
  onOpenSettings,
  cloudConnected,
  agentConnected = false,
  isMobileOpen,
  setIsMobileOpen,
}: SidebarProps) {
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)

  // Close profile dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const initials = (user.displayName || user.email || 'U')[0].toUpperCase()

  return (
    <>
      {/* Mobile backdrop overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      <aside
        className={`
          fixed md:static inset-y-0 left-0 z-50
          w-60 bg-[#f5f5f5] border-r border-[#e5e5e5] flex flex-col justify-between p-3.5 select-none
          transition-transform duration-200 ease-in-out shrink-0 h-full
          ${isMobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        <div className="space-y-5">
          {/* Top Branding */}
          <div className="flex items-center justify-between px-1.5 pt-1">
            <div className="flex items-center gap-2.5">
              <img src={chipLogo} alt="Chip Logo" className="w-5 h-5 rounded object-contain shadow-xs" />
              <span className="font-semibold text-sm tracking-tight text-black">Chip</span>
            </div>
            <button
              className="text-[#888888] hover:text-black p-1 rounded md:hidden"
              onClick={() => setIsMobileOpen(false)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1 text-[13px]">
            <button
              onClick={() => { onSelectTab('dashboard'); setIsMobileOpen(false) }}
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 font-medium text-left rounded transition-colors cursor-pointer ${
                currentTab === 'dashboard'
                  ? 'text-black bg-[#ebebeb]'
                  : 'text-[#666666] hover:bg-[#eaeaea] hover:text-black'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <rect width="7" height="9" x="3" y="3" rx="1" />
                <rect width="7" height="5" x="14" y="3" rx="1" />
                <rect width="7" height="9" x="14" y="12" rx="1" />
                <rect width="7" height="5" x="3" y="16" rx="1" />
              </svg>
              <span>Dashboard</span>
            </button>

            <button
              onClick={() => { onSelectTab('history'); setIsMobileOpen(false) }}
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 font-medium text-left rounded transition-colors cursor-pointer ${
                currentTab === 'history'
                  ? 'text-black bg-[#ebebeb]'
                  : 'text-[#666666] hover:bg-[#eaeaea] hover:text-black'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>Job History</span>
            </button>

            <button
              onClick={() => { onSelectTab('setup'); setIsMobileOpen(false) }}
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 font-medium text-left rounded transition-colors cursor-pointer ${
                currentTab === 'setup'
                  ? 'text-black bg-[#ebebeb]'
                  : 'text-[#666666] hover:bg-[#eaeaea] hover:text-black'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span>Setup</span>
            </button>
          </nav>

          {/* Connected Agents Section */}
          <div className="pt-1">
            <div className="flex items-center justify-between px-2.5 mb-2">
              <div className="flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#888888]">
                  <path d="M12 2a8 8 0 0 0-8 8c0 3.36 2.07 6.24 5 7.42V20a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2.58c2.93-1.18 5-4.06 5-7.42a8 8 0 0 0-8-8z" />
                  <path d="M9.5 9h.01" /><path d="M14.5 9h.01" /><path d="M9.5 13a3.5 3.5 0 0 0 5 0" />
                </svg>
                <span className="text-[12px] font-medium text-[#666666]">Agents</span>
              </div>
            </div>

            <div className="px-2.5 py-2 bg-white border border-[#e5e5e5] rounded text-[12px] space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-black">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 2v4" /><path d="M12 18v4" />
                    <path d="m4.93 4.93 2.83 2.83" /><path d="m16.24 16.24 2.83 2.83" />
                    <path d="M2 12h4" /><path d="M18 12h4" />
                    <path d="m4.93 19.07 2.83-2.83" /><path d="m16.24 7.76 2.83-2.83" />
                  </svg>
                  <span className="font-medium text-black">MCP Server</span>
                </div>
                <span className={`text-[10px] font-semibold flex items-center gap-1 ${
                  agentConnected ? 'text-[#16a34a]' : 'text-[#b45309]'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    agentConnected ? 'bg-[#16a34a]' : 'bg-[#b45309]'
                  }`} />
                  {agentConnected ? 'Connected' : 'Not connected'}
                </span>
              </div>
              <p className="text-[11px] text-[#888888] leading-tight pl-4">
                Universal Model Context Protocol.
              </p>
            </div>
          </div>
        </div>

        {/* Bottom Section: Status & User Profile */}
        <div className="space-y-2 pt-4 border-t border-[#e5e5e5]">
          {/* Cloud Relay status badge */}
          <div className="px-2.5 py-1.5 bg-white border border-[#e5e5e5] rounded flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#666666]">
                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
              </svg>
              <span className="text-[#666666]">Cloud Gateway</span>
            </div>
            <span className={`font-semibold flex items-center gap-1 ${cloudConnected ? 'text-[#16a34a]' : 'text-[#888888]'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cloudConnected ? 'bg-[#16a34a]' : 'bg-[#888888]'}`} />
              {cloudConnected ? 'Online' : 'Offline'}
            </span>
          </div>

          {/* User Profile Card with animated dropdown */}
          <div className="relative" ref={profileRef}>
            {/* Animated dropdown — grows from the bottom of the card upward */}
            <div
              className="overflow-hidden transition-all duration-200 ease-in-out"
              style={{ maxHeight: profileOpen ? '120px' : '0px', opacity: profileOpen ? 1 : 0 }}
            >
              <div className="bg-white border border-[#e5e5e5] border-b-0 rounded-t px-1 pt-1 pb-0.5 space-y-0.5">
                {/* Manual Flash option */}
                <button
                  onClick={() => { onSelectTab('manual'); setIsMobileOpen(false); setProfileOpen(false) }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-[12px] rounded transition-colors cursor-pointer ${
                    currentTab === 'manual'
                      ? 'text-black bg-[#ebebeb] font-medium'
                      : 'text-[#444444] hover:bg-[#f3f3f3] hover:text-black'
                  }`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="16" height="16" x="4" y="4" rx="2" />
                    <rect width="6" height="6" x="9" y="9" rx="1" />
                    <path d="M9 1v3" /><path d="M15 1v3" />
                    <path d="M9 20v3" /><path d="M15 20v3" />
                    <path d="M20 9h3" /><path d="M20 14h3" />
                    <path d="M1 9h3" /><path d="M1 14h3" />
                  </svg>
                  Manual Flash
                </button>

                {/* Settings option */}
                <button
                  onClick={() => {
                    if (onOpenSettings) onOpenSettings()
                    setIsMobileOpen(false)
                    setProfileOpen(false)
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-[12px] text-[#444444] hover:bg-[#f3f3f3] hover:text-black rounded transition-colors cursor-pointer"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  Settings
                </button>
                {/* Sign out option */}
                <button
                  onClick={onSignOut}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-[12px] text-[#888888] hover:bg-[#f3f3f3] hover:text-[#dc2626] rounded transition-colors cursor-pointer"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Sign out
                </button>
              </div>
            </div>

            {/* Profile row — clicking toggles the dropdown */}
            <button
              onClick={() => setProfileOpen((o) => !o)}
              className={`w-full flex items-center gap-2 p-2 bg-white border border-[#e5e5e5] text-left transition-colors cursor-pointer ${
                profileOpen ? 'rounded-b' : 'rounded'
              } hover:bg-[#f8f8f8]`}
            >
              {/* Avatar */}
              <div className="w-6 h-6 rounded overflow-hidden shrink-0 bg-black text-white text-[11px] font-semibold flex items-center justify-center">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt="avatar"
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      // Fallback to initials if image fails
                      const el = e.currentTarget
                      el.style.display = 'none'
                      el.parentElement!.textContent = initials
                    }}
                  />
                ) : (
                  initials
                )}
              </div>

              {/* Name + email */}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-black truncate leading-tight">
                  {user.displayName || 'User'}
                </div>
                <div className="text-[10px] text-[#888888] truncate leading-none mt-0.5">
                  {user.email}
                </div>
              </div>

              {/* Chevron rotates when open */}
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`shrink-0 text-[#888888] transition-transform duration-200 ${profileOpen ? 'rotate-180' : ''}`}
              >
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
