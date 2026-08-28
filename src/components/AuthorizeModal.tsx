import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import chipLogo from '../assets/ChipLogo.png'

interface AuthorizeModalProps {
  user: User
  sessionId: string
  backendUrl: string
  mcpUrl: string
}

interface SyncState {
  backendOnline: boolean | null
  dbConnected: boolean | null
  mcpOnline: boolean | null
  loading: boolean
}

export function AuthorizeModal({ user, sessionId, backendUrl, mcpUrl }: AuthorizeModalProps) {
  const [sync, setSync] = useState<SyncState>({
    backendOnline: null,
    dbConnected: null,
    mcpOnline: null,
    loading: true,
  })
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function checkSync() {
      let bOnline = false
      let dbConn = false
      let mOnline = false

      // 1. Check Backend
      try {
        const bRes = await fetch(`${backendUrl}/health`, { signal: AbortSignal.timeout(5000) })
        if (bRes.ok) {
          const data = await bRes.json()
          bOnline = true
          dbConn = !!data.dbConnected
        }
      } catch {
        bOnline = false
      }

      // 2. Check MCP Server (health is at root, not /mcp)
      try {
        const mcpBase = mcpUrl.replace(/\/mcp\/?$/, '')
        const mRes = await fetch(`${mcpBase}/health`, { signal: AbortSignal.timeout(5000) })
        if (mRes.ok) {
          mOnline = true
        }
      } catch {
        mOnline = false
      }

      if (isMounted) {
        setSync({
          backendOnline: bOnline,
          dbConnected: dbConn,
          mcpOnline: mOnline,
          loading: false,
        })
      }
    }

    checkSync()
    return () => {
      isMounted = false
    }
  }, [backendUrl, mcpUrl])

  const handleApprove = async () => {
    setApproving(true)
    setError(null)

    try {
      const idToken = await user.getIdToken()
      const resp = await fetch(`${backendUrl}/oauth/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, sessionId }),
      })

      const data = await resp.json()
      if (!resp.ok) {
        throw new Error(data.error || 'Failed to authorize connection')
      }

      setSuccess(true)
      localStorage.setItem('chip_agent_connected', 'true')
      window.location.replace(data.redirectUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setApproving(false)
    }
  }

  const allSynced = sync.backendOnline && sync.mcpOnline

  return (
    <div className="min-h-screen bg-[#f5f5f5] flex items-center justify-center p-6">
      <div className="bg-white border border-[#e5e5e5] rounded-md p-8 max-w-[440px] w-full text-left shadow-none">
        {/* Header with Brand Logo */}
        <div className="flex items-center gap-3 mb-5">
          <img src={chipLogo} alt="Chip Logo" className="w-8 h-8 rounded object-contain shadow-xs shrink-0" />
          <div>
            <h1 className="text-base font-semibold text-black tracking-tight leading-tight">
              Authorize Agent Connection
            </h1>
            <p className="text-xs text-[#666666] mt-0.5">
              AI Agent is requesting access to compile and flash your ESP32.
            </p>
          </div>
        </div>

        {/* User Identity Box */}
        <div className="bg-[#fafafa] border border-[#e5e5e5] rounded p-3 flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded bg-black text-white flex items-center justify-center text-xs font-semibold overflow-hidden shrink-0">
            {user.photoURL ? (
              <img src={user.photoURL} alt="avatar" className="w-full h-full object-cover rounded" />
            ) : (
              (user.displayName || user.email || 'U')[0].toUpperCase()
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-black truncate">
              {user.displayName || 'Authenticated User'}
            </div>
            <div className="text-[11px] text-[#666666] truncate">
              {user.email}
            </div>
          </div>
        </div>

        {/* System Sync Verification Table */}
        <div className="bg-white border border-[#e5e5e5] rounded p-3.5 mb-5 text-xs">
          <div className="text-xs font-medium text-[#666666] mb-2.5">
            System Sync Verification
          </div>
          <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-[#f0f0f0]">
            <span className="text-black">Client Dashboard</span>
            <span className="text-[#16a34a] font-semibold">● Active</span>
          </div>
          <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-[#f0f0f0]">
            <span className="text-black">Backend Gateway</span>
            <span className={sync.backendOnline ? 'text-[#16a34a] font-semibold' : sync.loading ? 'text-[#f59e0b] font-semibold' : 'text-[#dc2626] font-semibold'}>
              {sync.loading ? '○ Checking...' : sync.backendOnline ? (sync.dbConnected ? '● Online (DB Synced)' : '● Online') : '✕ Offline'}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-black">AI Agent MCP Server</span>
            <span className={sync.mcpOnline ? 'text-[#16a34a] font-semibold' : sync.loading ? 'text-[#f59e0b] font-semibold' : 'text-[#dc2626] font-semibold'}>
              {sync.loading ? '○ Checking...' : sync.mcpOnline ? '● Ready' : '✕ Offline'}
            </span>
          </div>
        </div>

        {error && (
          <div className="text-[#dc2626] text-xs mb-3.5 bg-[#fef2f2] border border-[#fecaca] p-2.5 rounded">
            {error}
          </div>
        )}

        {success && (
          <div className="text-[#16a34a] text-xs mb-3.5 bg-[#f0fdf4] border border-[#bbf7d0] p-2.5 rounded font-medium">
            ✓ Connection approved! Redirecting back to agent...
          </div>
        )}

        <button
          className="w-full bg-black hover:bg-[#222222] text-white font-medium py-3 px-4 rounded border border-black transition-colors disabled:opacity-40 text-sm cursor-pointer disabled:cursor-not-allowed"
          disabled={approving || !allSynced}
          onClick={handleApprove}
        >
          {approving ? 'Connecting to Agent...' : 'Approve & Connect Agent'}
        </button>
      </div>
    </div>
  )
}
