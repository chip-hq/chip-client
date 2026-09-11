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
  isMobileOpen: boolean
  setIsMobileOpen: (open: boolean) => void
  desktopOpen: boolean
  onDesktopOpenChange: (open: boolean) => void
}

export function Sidebar({
  user,
  currentTab,
  onSelectTab,
  onSignOut,
  onOpenSettings,
  cloudConnected,
  isMobileOpen,
  setIsMobileOpen,
  desktopOpen,
  onDesktopOpenChange,
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

  const closeDesktop = () => onDesktopOpenChange(false)

  return (
    <>
      {/* Mobile Drawer Overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden animate-in fade-in duration-200"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Main Sidebar Panel */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-50 flex flex-col bg-[#f5f5f5] border-r border-[#e5e5e5] h-screen transition-all duration-200 ease-in-out select-none ${
          isMobileOpen ? 'translate-x-0 w-64' : '-translate-x-full md:translate-x-0'
        } ${desktopOpen ? 'md:w-56' : 'md:hidden'}`}
      >
        <div className="flex flex-col h-full p-2.5">
          {/* Header with App Logo & Collapse */}
          <div className="flex items-center gap-2 px-2 py-2 mb-2">
            <img src={chipLogo} alt="Chip" className="h-6 w-auto object-contain" />
            <span className="text-[11px] font-mono px-1.5 py-0.2 bg-[#ebebeb] border border-[#d8d8d8] text-[#555] rounded">
              BETA
            </span>
            <button
              type="button"
              className="ml-auto text-[#888888] hover:text-black p-1 rounded hover:bg-[#ebebeb] transition-colors cursor-pointer"
              onClick={() => {
                setIsMobileOpen(false)
                closeDesktop()
              }}
              title="Close sidebar"
              aria-label="Close sidebar"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
                <path d="m16 15-3-3 3-3" />
              </svg>
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-0.5 pt-1">
            <button
              onClick={() => { onSelectTab('dashboard'); setIsMobileOpen(false) }}
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded text-[13px] font-medium transition-colors cursor-pointer text-left ${
                currentTab === 'dashboard'
                  ? 'bg-[#ebebeb] text-black font-semibold'
                  : 'text-[#555555] hover:bg-[#ebebeb]/60 hover:text-black'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="7" height="9" x="3" y="3" rx="1" />
                <rect width="7" height="5" x="14" y="3" rx="1" />
                <rect width="7" height="9" x="14" y="12" rx="1" />
                <rect width="7" height="5" x="3" y="16" rx="1" />
              </svg>
              <span>Dashboard</span>
            </button>

            <button
              onClick={() => { onSelectTab('history'); setIsMobileOpen(false) }}
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded text-[13px] font-medium transition-colors cursor-pointer text-left ${
                currentTab === 'history'
                  ? 'bg-[#ebebeb] text-black font-semibold'
                  : 'text-[#555555] hover:bg-[#ebebeb]/60 hover:text-black'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>Job History</span>
            </button>

            <button
              onClick={() => { onSelectTab('setup'); setIsMobileOpen(false) }}
              className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded text-[13px] font-medium transition-colors cursor-pointer text-left ${
                currentTab === 'setup'
                  ? 'bg-[#ebebeb] text-black font-semibold'
                  : 'text-[#555555] hover:bg-[#ebebeb]/60 hover:text-black'
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span>Setup Guide</span>
            </button>
          </nav>

        </div>

        {/* Bottom Section: Status & User Profile */}
        <div className="space-y-2 pt-4 border-t border-[#e5e5e5]">
          {/* Cloud Relay status badge */}
          <div className="mx-1 px-2.5 py-1.5 bg-white border border-[#e5e5e5] rounded flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#666666]">
                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
              </svg>
              <span className="text-[#666666]">Cloud Gateway</span>
            </div>
            <span className={`font-semibold ${cloudConnected ? 'text-[#16a34a]' : 'text-[#888888]'}`}>
              {cloudConnected ? 'Online' : 'Offline'}
            </span>
          </div>

          {/* User Profile Card with animated dropdown */}
          <div className="relative mx-1" ref={profileRef}>
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
