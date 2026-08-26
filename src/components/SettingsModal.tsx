interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  companionEnabled: boolean
  onToggleCompanion: (enabled: boolean) => void
  backendUrl: string
  authToken?: string | null
}

export function SettingsModal({
  isOpen,
  onClose,
  companionEnabled,
  onToggleCompanion,
  backendUrl,
  authToken,
}: SettingsModalProps) {
  if (!isOpen) return null

  const handleToggle = async (enabled: boolean) => {
    onToggleCompanion(enabled)
    try {
      await fetch(`${backendUrl}/api/preferences`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ webCompanion: enabled }),
      })
    } catch {
      // non-fatal — localStorage still holds the value
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-white border border-[#e5e5e5] rounded-xl w-[500px] h-[360px] shadow-xl flex overflow-hidden animate-in fade-in zoom-in-95 duration-150 select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left Main Content Area */}
        <div className="flex-1 p-5 flex flex-col justify-between h-full">
          <div>
            <div className="text-xs font-semibold text-black tracking-tight mb-4">
              AI Web Companion
            </div>

            <div className="flex items-center justify-between py-2 border-b border-[#f5f5f5]">
              <div>
                <div className="text-xs font-medium text-black">Generate Web Companion</div>
                <div className="text-[11px] text-[#888888] mt-0.5 max-w-[200px]">
                  Creates digital twins matching your C++ firmware
                </div>
              </div>

              {/* iOS Style Toggle Switch */}
              <button
                type="button"
                role="switch"
                aria-checked={companionEnabled}
                onClick={() => handleToggle(!companionEnabled)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  companionEnabled ? 'bg-black' : 'bg-[#d1d5db]'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                    companionEnabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="flex justify-between items-center pt-3 text-[10px] text-[#888888] font-mono border-t border-[#f0f0f0]">
            <span>Chip v1.0.0</span>
          </div>
        </div>

        {/* Right Sidebar (Settings Nav) */}
        <div className="w-44 bg-[#fafafa] border-l border-[#e5e5e5] p-3 flex flex-col justify-between shrink-0 h-full">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-[#888888] px-2 py-1">
              Settings
            </div>

            <button
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[#ebebeb] text-black transition-colors cursor-pointer text-left"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              <span>AI Companion</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
