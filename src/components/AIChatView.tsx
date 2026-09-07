import React, { useState, useEffect, useRef } from 'react'
import {
  circuitChatApi,
  fetchCircuitModelsApi,
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
  onNavigateToStudio?: (projectId?: string) => void
  compact?: boolean
}

interface MessageItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  actions?: CircuitActionResult[]
  timestamp: Date
}

function renderAssistantContent(content: string): React.ReactNode {
  return content.split('\n').map((line, lineIndex) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g)
    return (
      <span key={lineIndex} className="block min-h-[1em]">
        {parts.map((part, partIndex) =>
          part.startsWith('**') && part.endsWith('**')
            ? <strong key={partIndex}>{part.slice(2, -2)}</strong>
            : part
        )}
      </span>
    )
  })
}

const WELCOME_MESSAGE: MessageItem = {
  id: 'welcome',
  role: 'assistant',
  content:
    'Hello! I am your Hardware Automation AI Assistant powered by Featherless.\n\nTell me what you want to build (e.g. *"Add an ESP32 with an LED on GPIO 2 and a 220Ω resistor to GND"*), and I will automatically add parts, wire connections, and update your automation canvas in real time.',
  timestamp: new Date(),
}

const GENERATION_STEPS = ['Building', 'Wiring', 'Powering', 'Polishing']

function loadSavedMessages(pid: string): MessageItem[] {
  try {
    const raw = localStorage.getItem(`automation_ai_chat_${pid || 'default'}`)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((message) => {
          const item = message as Record<string, unknown>
          return {
            ...item,
            timestamp: new Date(typeof item.timestamp === 'string' || typeof item.timestamp === 'number' ? item.timestamp : Date.now()),
          } as MessageItem
        })
      }
    }
  } catch {
    return [WELCOME_MESSAGE]
  }
  return [WELCOME_MESSAGE]
}

function saveMessages(pid: string, msgs: MessageItem[]) {
  try {
    localStorage.setItem(`automation_ai_chat_${pid || 'default'}`, JSON.stringify(msgs))
  } catch {
    return
  }
}

export const AIChatView: React.FC<AIChatViewProps> = ({ onNavigateToStudio, compact = false }) => {
  const circuitState = useCircuitStore()
  const [currentPid, setCurrentPid] = useState<string>(circuitState.projectId || '')
  const [models, setModels] = useState<Array<{ id: string; name: string; units: number }>>([])
  const [selectedModel, setSelectedModel] = useState<string>('deepseek-ai/DeepSeek-V3.2')
  const [inputMessage, setInputMessage] = useState('')
  const [vineMentioned, setVineMentioned] = useState(false)
  const [loading, setLoading] = useState(false)
  const [generationStep, setGenerationStep] = useState(GENERATION_STEPS[0])
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

  const projectMentionLabel = currentPid || 'project'

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, loading])

  useEffect(() => {
    if (!loading) return
    let step = 0
    setGenerationStep(GENERATION_STEPS[step])
    const interval = window.setInterval(() => {
      step = (step + 1) % GENERATION_STEPS.length
      setGenerationStep(GENERATION_STEPS[step])
    }, 900)
    return () => window.clearInterval(interval)
  }, [loading])

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

  // Load available models; the circuit store remains the single project source.
  useEffect(() => {
    async function init() {
      try {
        const modelRes = await fetchCircuitModelsApi().catch(() => ({ models: [] }))
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

  const getActiveProject = (): string => {
    const activePid = circuitState.projectId || currentPid
    if (currentPid !== activePid) setCurrentPid(activePid)
    return activePid
  }

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputMessage).trim()
    if (!text || loading) return

    const pid = getActiveProject()
    if (!pid) {
      setMessages((prev) => [...prev, {
        id: Math.random().toString(36).substring(2, 9),
        role: 'assistant',
        content: 'Open an automation project first. I will build the flow in that project.',
        timestamp: new Date(),
      }])
      return
    }
    setInputMessage('')
    setVineMentioned(false)

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
          content: `${res.reply || 'Automation updated successfully.'}\n\nCanvas outputs are ready: Simulation, Pinout Map, and Wiring Guide.`,
          actions: res.actions || [],
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, assistantMsg])

        // Reload the project in CircuitStore so Automation Studio is immediately updated!
        circuitStore.setProject(pid)
        if (res.newVersion) {
          await circuitStore.loadProjectCircuit(pid, res.newVersion, true)
        }
        window.dispatchEvent(new CustomEvent('chip:automation-generated', { detail: { projectId: pid, version: res.newVersion } }))
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
      {!compact && (
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
              <span className="text-xs text-slate-500 font-medium">Project: {currentPid || 'none selected'}</span>
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
            {onNavigateToStudio && (
              <button
                onClick={() => onNavigateToStudio(currentPid)}
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
            className={`flex w-full max-w-2xl ${msg.role === 'user' ? 'ml-auto justify-end' : 'mr-auto items-start gap-2'}`}
          >
            {msg.role === 'assistant' && (
              <div className="relative flex w-5 shrink-0 justify-center self-stretch">
                <span className="absolute top-5 bottom-0 w-px bg-slate-200" />
                <span className="relative z-10 mt-1 grid h-5 w-5 place-items-center rounded-full border border-slate-200 bg-white text-slate-500">
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v4M12 17v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M3 12h4M17 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" />
                  </svg>
                </span>
              </div>
            )}

            <div className={`${msg.role === 'user' ? 'max-w-[85%]' : 'min-w-0 flex-1'} text-xs leading-relaxed`}>
              <div className="mb-1 flex items-center gap-1.5 text-[10px] text-slate-400">
                <span className="font-medium text-slate-500">{msg.role === 'user' ? 'You' : 'Assistant'}</span>
                <span>{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className={msg.role === 'user' ? 'rounded-2xl rounded-br-sm bg-slate-900 px-3.5 py-2.5 text-white' : 'px-0.5 py-0.5 text-slate-800'}>
                {msg.role === 'assistant' ? renderAssistantContent(msg.content) : msg.content}
              </div>

              {/* Action Badges */}
              {msg.actions && msg.actions.length > 0 && (
                <div className="mt-3 pt-2.5 border-t border-slate-200/80 space-y-1.5">
                  <span className="text-[10px] font-bold text-slate-500 tracking-wider block">
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
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2">
              <span className="text-[11px] text-slate-500">{generationStep}...</span>
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

      {/* ── Chat Input ──────────────────────────────────────────────────────── */}
      <div className={`border-t border-slate-200 bg-white ${compact ? 'p-2.5' : 'p-4'}`}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSendMessage()
          }}
          className="flex items-center gap-2"
        >
          {vineMentioned && (
            <button
              type="button"
              onClick={() => setVineMentioned(false)}
              className="inline-flex h-7 max-w-44 shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-100 px-1.5 text-[10px] font-medium text-slate-600 shadow-2xs hover:border-slate-300 hover:bg-slate-200"
              title={`Remove ${projectMentionLabel} mention`}
            >
              <span className="grid h-4 w-4 place-items-center rounded-[4px] bg-slate-800 text-[8px] font-bold text-white">P</span>
              <span className="truncate">{projectMentionLabel}</span>
              <span className="text-slate-400">×</span>
            </button>
          )}
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => {
              const raw = e.target.value
              if (/@vine\b/i.test(raw)) {
                setVineMentioned(true)
                setInputMessage(raw.replace(/@vine\b/gi, '').replace(/^\s+/, ''))
              } else {
                setInputMessage(raw)
              }
            }}
            disabled={loading}
            placeholder="Describe how this project should work..."
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
