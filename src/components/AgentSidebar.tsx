import { AIChatView } from './AIChatView'
import { useCircuitStore } from '../circuit/store'

interface AgentSidebarProps {
  open: boolean
  onClose: () => void
  showAlert?: never
}

export function AgentSidebar({
  open,
  onClose,
}: AgentSidebarProps) {
  const { projectId } = useCircuitStore()

  if (!open) return null

  return (
    <div className="agent-drawer shrink-0 border border-[#e5e5e5] bg-[#f5f5f5] rounded-xl flex flex-col overflow-hidden m-2 transition-all duration-150">
      {/* Header & Tabs */}
      <div className="px-3 pt-2.5 pb-2 border-b border-[#efefef] shrink-0 bg-white">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-bold text-slate-800">Agent Studio</span>
            <span className="max-w-36 truncate text-[10px] font-mono px-1.5 py-0.5 bg-[#f3f3f3] border border-[#e5e5e5] rounded text-[#666]" title={projectId || 'No project selected'}>
              {projectId || 'No project'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-[#aaa] hover:text-black transition-colors p-1 rounded hover:bg-[#f5f5f5] cursor-pointer"
            title="Close sidebar"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

      </div>

      <div className="flex-1 flex flex-col overflow-hidden bg-white">
        <AIChatView compact />
      </div>
    </div>
  )
}
