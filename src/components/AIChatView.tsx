import React, { useState, useEffect, useRef } from 'react'
import {
  circuitChatApi,
  listProjectsApi,
  fetchCircuitModelsApi,
  createProjectApi,
  type ChatMessage,
  type CircuitActionResult,
} from '../circuit/api'
import { circuitStore, useCircuitStore } from '../circuit/store'
import { CleanDropdown, type DropdownOption } from './CleanDropdown'

const FALLBACK_MODELS: DropdownOption[] = [
  { value: 'deepseek-ai/DeepSeek-V3.2', label: 'DeepSeek V3.2', hint: 'Reasoning & code' },
  { value: 'mistralai/Mistral-Nemo-Instruct-2407', label: 'Mistral Nemo', hint: 'Fast · 1 unit' },
  { value: 'MiniMaxAI/MiniMax-M2.5', label: 'MiniMax M2.5', hint: 'Agent & tools' },
  { value: 'moonshotai/Kimi-K2.5', label: 'Kimi K2.5', hint: 'Long context' },
]

interface AIChatViewProps {
  onNavigateToCircuit?: (projectId?: string) => void
  compact?: boolean
}

interface MessageItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  actions?: CircuitActionResult[]
  timestamp: Date
}

const QUICK_PROMPTS = [
  'Add an ESP32 with an LED on GPIO 2 and 220Ω resistor to GND',
  'Add a DHT22 temperature sensor on GPIO 4 and a 5V relay on GPIO 26',
  'Add an I2C OLED display (SSD1306) on GPIO 21 (SDA) and GPIO 22 (SCL)',
  'Connect a pushbutton trigger to GPIO 14 with pullup to GND',
  'Add a PIR motion sensor on GPIO 14 and piezo buzzer on GPIO 15',
]

const WELCOME_MESSAGE: MessageItem = {
  id: 'welcome',
  role: 'assistant',
  content:
    'Hello! I am your Hardware Automation AI Assistant powered by Featherless.\n\nTell me what you want to build (e.g. *"Add an ESP32 with an LED on GPIO 2 and a 220Ω resistor to GND"*), and I will automatically add parts, wire connections, and update your automation canvas in real time.',
  timestamp: new Date(),
}

function loadSavedMessages(pid: string): MessageItem[] {
  try {
    const raw = localStorage.getItem(`automation_ai_chat_${pid || 'default'}`)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp || Date.now()),
        }))
      }
    }
  } catch {}
  return [WELCOME_MESSAGE]
}

function saveMessages(pid: string, msgs: MessageItem[]) {
  try {
    localStorage.setItem(`automation_ai_chat_${pid || 'default'}`, JSON.stringify(msgs))
  } catch {}
}

export const AIChatView: React.FC<AIChatViewProps> = ({ onNavigateToCircuit, compact = false }) => {
  const circuitState = useCircuitStore()
  const [projects, setProjects] = useState<Array<{ projectId: string; name: string }>>([])
  const [currentPid, setCurrentPid] = useState<string>(circuitState.projectId || '')
  const [models, setModels] = useState<Array<{ id: string; name: string; units: number }>>([])
  const [selectedModel, setSelectedModel] = useState<string>('deepseek-ai/DeepSeek-V3.2')
  const [inputMessage, setInputMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<MessageItem[]>(() => loadSavedMessages(''))

  const messagesEndRef = useRef<HTMLDivElement>(null)

  const modelOptions: DropdownOption[] =
    models.length > 0
      ? models.map((m) => ({
          value: m.id,
          label: m.name,
          hint: `${m.units} unit${m.units > 1 ? 's' : ''}`,
        }))
      : FALLBACK_MODELS

  const projectOptions: DropdownOption[] = projects.map((p) => ({
    value: p.projectId,
    label: p.name || p.projectId,
  }))

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, loading])

  // Save messages whenever they change
  useEffect(() => {
    if (messages.length > 1 || (messages.length === 1 && messages[0].id !== 'welcome')) {
      saveMessages(currentPid, messages)
    }
  }, [messages, currentPid])

  // Load project messages when currentPid changes
  useEffect(() => {
    if (currentPid) {
      setMessages(loadSavedMessages(currentPid))
    }
  }, [currentPid])

  // Load projects and models on mount
  useEffect(() => {
    async function init() {
      try {
        const [projRes, modelRes] = await Promise.all([
          listProjectsApi().catch(() => ({ projects: [] })),
          fetchCircuitModelsApi().catch(() => ({ models: [] })),
        ])

        if (projRes?.projects?.length) {
          setProjects(projRes.projects)
          const firstPid = projRes.projects[0].projectId
          setCurrentPid(firstPid)
          setMessages(loadSavedMessages(firstPid))
        }

        if (modelRes?.models?.length) {
          setModels(modelRes.models)
          setSelectedModel(modelRes.models[0].id)
        }
      } catch {
        // ignore
      }
    }
    init()
  }, [])

  // Keep currentPid in sync with circuitStore's selected project
  useEffect(() => {
    if (circuitState.projectId && circuitState.projectId !== currentPid) {
      setCurrentPid(circuitState.projectId)
    }
  }, [circuitState.projectId])

  const ensureProject = async (): Promise<string> => {
    const activePid = circuitState.projectId || currentPid
    if (activePid) {
      if (currentPid !== activePid) setCurrentPid(activePid)
      return activePid
    }
    try {
      const res = await createProjectApi({
        name: 'AI Automation Project',
        description: 'Auto-created automation project for AI prompt automation',
      })
      if (res?.project?.projectId) {
        const newId = res.project.projectId
        setProjects((prev) => [...prev, { projectId: newId, name: res.project.name }])
        setCurrentPid(newId)
        circuitStore.setProject(newId)
        return newId
      }
    } catch {
      // fallback
    }
    return 'ai-automation-project'
  }

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputMessage).trim()
    if (!text || loading) return

    const pid = await ensureProject()
    setInputMessage('')

    const userMsg: MessageItem = {
      id: Math.random().toString(36).substring(2, 9),
      role: 'user',
      content: text,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      // Convert history for API
      const history: ChatMessage[] = messages
        .filter((m) => m.id !== 'welcome')
        .map((m) => ({ role: m.role, content: m.content }))

      const res = await circuitChatApi({
        projectId: pid,
        message: text,
        history,
        model: selectedModel,
      })

      if (res?.success) {
        const assistantMsg: MessageItem = {
          id: Math.random().toString(36).substring(2, 9),
          role: 'assistant',
          content: res.reply || 'Automation updated successfully.',
          actions: res.actions || [],
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, assistantMsg])

        // Reload the project in CircuitStore so Automation Studio is immediately updated!
        circuitStore.setProject(pid)
        if (res.newVersion) {
          circuitStore.loadProjectCircuit(pid, res.newVersion, true)
        }
      } else {
        const errorMsg: MessageItem = {
          id: Math.random().toString(36).substring(2, 9),
          role: 'assistant',
          content: `Error: ${res?.error || 'Failed to process automation prompt. Please try again.'}`,
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, errorMsg])
      }
    } catch (err) {
      const errorMsg: MessageItem = {
        id: Math.random().toString(36).substring(2, 9),
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full w-full bg-white overflow-hidden select-none">
      {/* ── Top Bar ────────────────────────────────────────────────────────── */}
      {compact ? (
        <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-white shrink-0">
          <div className="flex items-center gap-1.5 flex-1 min-w-0 mr-2">
            <span className="text-[10px] uppercase font-semibold text-slate-400 shrink-0">Model</span>
            <CleanDropdown
              value={selectedModel}
              options={modelOptions}
              onChange={setSelectedModel}
              className="flex-1 min-w-0"
            />
          </div>

          <button
            onClick={() => {
              const fresh = [WELCOME_MESSAGE]
              setMessages(fresh)
              saveMessages(currentPid, fresh)
            }}
            className="text-[11px] text-slate-400 hover:text-rose-600 px-2 py-1 rounded hover:bg-slate-50 transition cursor-pointer shrink-0 font-medium"
            title="Clear chat history"
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shadow-xs">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                Automation AI Assistant
                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                  Featherless
                </span>
              </h2>
              <p className="text-[11px] text-slate-500">Natural language hardware automation & workflow builder</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Project Picker */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 font-medium">Project</span>
              <CleanDropdown
                value={currentPid}
                options={projectOptions}
                onChange={setCurrentPid}
                placeholder="Auto-create project"
                size="md"
              />
            </div>

            {/* Model Picker */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 font-medium">Model</span>
              <CleanDropdown
                value={selectedModel}
                options={modelOptions}
                onChange={setSelectedModel}
                size="md"
              />
            </div>

            {/* Clear Chat Button */}
            <button
              onClick={() => {
                const fresh = [WELCOME_MESSAGE]
                setMessages(fresh)
                saveMessages(currentPid, fresh)
              }}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-500 hover:text-rose-600 bg-slate-50 hover:bg-rose-50 rounded-lg border border-slate-200 hover:border-rose-200 transition cursor-pointer"
              title="Clear chat history for this project"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Clear
            </button>

            {/* Open in Automation Studio */}
            {onNavigateToCircuit && (
              <button
                onClick={() => onNavigateToCircuit(currentPid)}
                className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-200 transition cursor-pointer"
              >
                <svg className="w-3.5 h-3.5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M9 9h6v6H9z" />
                </svg>
                Open Automation Studio
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Message Log ────────────────────────────────────────────────────── */}
      <div className={`flex-1 overflow-y-auto ${compact ? 'p-3 space-y-3' : 'p-6 space-y-4'}`}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex flex-col max-w-2xl ${msg.role === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'}`}
          >
            <div className="flex items-center gap-1.5 mb-1 px-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {msg.role === 'user' ? 'You' : 'Automation Assistant'}
              </span>
              <span className="text-[10px] text-slate-400">
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            <div
              className={`rounded-2xl px-4 py-3 text-xs leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-slate-900 text-white shadow-xs rounded-br-xs'
                  : 'bg-slate-50 border border-slate-200 text-slate-800 shadow-xs rounded-bl-xs'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>

              {/* Action Badges */}
              {msg.actions && msg.actions.length > 0 && (
                <div className="mt-3 pt-2.5 border-t border-slate-200/80 space-y-1.5">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Executed Automation Actions ({msg.actions.length})
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {msg.actions.map((act, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700 shadow-2xs"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        {act.description}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex flex-col max-w-2xl mr-auto items-start">
            <div className="flex items-center gap-2 mb-1 px-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Automation Assistant</span>
              <span className="text-[10px] text-amber-500 font-medium">Generating automation...</span>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl rounded-bl-xs px-4 py-3 shadow-xs">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-bounce" />
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-bounce [animation-delay:0.2s]" />
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Quick Prompt Suggestion Chips ───────────────────────────────────── */}
      <div className={`border-t border-slate-100 bg-white flex items-center gap-1.5 overflow-x-auto no-scrollbar ${compact ? 'px-3 py-1.5' : 'px-6 py-2'}`}>
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider shrink-0">
          Try:
        </span>
        {QUICK_PROMPTS.map((prompt, idx) => (
          <button
            key={idx}
            onClick={() => handleSendMessage(prompt)}
            disabled={loading}
            className={`text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-full shrink-0 transition disabled:opacity-50 cursor-pointer ${
              compact ? 'text-[10px] px-2.5 py-0.5' : 'text-[11px] px-3 py-1'
            }`}
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* ── Chat Input ──────────────────────────────────────────────────────── */}
      <div className={`border-t border-slate-200 bg-white ${compact ? 'p-2.5' : 'p-4'}`}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSendMessage()
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            disabled={loading}
            placeholder={compact ? "Prompt AI to build automation..." : "Ask AI to build or wire an automation (e.g. 'Add an ESP32 and wire an LED to GPIO 2 with 220Ω resistor')..."}
            className={`flex-1 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-hidden focus:border-slate-400 focus:bg-white transition ${
              compact ? 'px-3 py-2 text-[11px]' : 'px-4 py-2.5'
            }`}
          />
          <button
            type="submit"
            disabled={loading || !inputMessage.trim()}
            className={`flex items-center justify-center rounded-xl bg-slate-900 hover:bg-slate-800 text-white transition disabled:opacity-40 cursor-pointer shrink-0 ${
              compact ? 'w-8 h-8' : 'w-9 h-9'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  )
}
