/**
 * WebMCPRoomPage — lightweight landing page for agent browsers
 * Served at /webmcp/rooms/:roomKey?invite=agent#webmcp
 *
 * When an agent (ChatGPT Codex, Claude) navigates here it finds:
 *  • document.modelContext tools (if Chrome WebMCP flag enabled)
 *  • window.__chipWebMCP tools (always available)
 *  • Visible status card with board state for agents that can read DOM text
 */
import { useEffect, useState } from 'react'
import { registerWebMCPTools, setDashboardSnapshotProvider } from '../webmcp/tools'

export function WebMCPRoomPage() {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)

  // Parse room key from URL
  const roomKey = window.location.pathname.split('/webmcp/rooms/')[1]?.split('?')[0] ?? 'unknown'

  useEffect(() => {
    // Register WebMCP tools so agents can call them
    registerWebMCPTools()

    // Try to read board status immediately and display it on page
    ;(async () => {
      try {
        const result = await window.__chipWebMCP?.getBoardStatus()
        if (result?.content?.[0]?.text) {
          setStatus(JSON.parse(result.content[0].text))
        }
      } catch {
        // no board connected yet
      }
    })()
  }, [])

  return (
    <div
      id="webmcp-room"
      data-room-key={roomKey}
      data-webmcp="true"
      style={{
        fontFamily: 'monospace',
        padding: '32px',
        maxWidth: '600px',
        margin: '0 auto',
        color: '#111',
      }}
    >
      <h1 style={{ fontSize: '18px', marginBottom: '8px' }}>
        🔌 CHIP WebMCP Room
      </h1>
      <p style={{ fontSize: '12px', color: '#666', marginBottom: '24px' }}>
        Room: <strong>{roomKey}</strong>
      </p>

      {/* Agent-readable status block */}
      <div
        id="webmcp-status"
        style={{
          background: '#f5f5f5',
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          padding: '16px',
          fontSize: '12px',
          lineHeight: '1.7',
        }}
      >
        <p><strong>WebMCP Tools Available:</strong></p>
        <ul style={{ paddingLeft: '16px', margin: '8px 0' }}>
          <li>list_devices — list connected ESP32 hardware</li>
          <li>get_board_status — board chip, baud rate, gateway</li>
          <li>read_serial_logs — live serial terminal output</li>
          <li>read_job_status — compile/flash pipeline progress</li>
          <li>read_dashboard_state — full dashboard snapshot</li>
        </ul>

        {status ? (
          <div style={{ marginTop: '12px', borderTop: '1px solid #ddd', paddingTop: '12px' }}>
            <p><strong>Current Board Status:</strong></p>
            <pre
              id="webmcp-board-status"
              style={{ fontSize: '11px', whiteSpace: 'pre-wrap', margin: '4px 0 0' }}
            >
              {JSON.stringify(status, null, 2)}
            </pre>
          </div>
        ) : (
          <p style={{ marginTop: '12px', color: '#999' }}>
            Loading board status… (call window.__chipWebMCP.getBoardStatus() to read)
          </p>
        )}
      </div>

      <p style={{ fontSize: '11px', color: '#aaa', marginTop: '16px' }}>
        Call <code>window.__chipWebMCP.list_devices()</code> or use document.modelContext tools.
      </p>
    </div>
  )
}
