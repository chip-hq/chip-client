import React, { useState, useEffect, useRef } from 'react'
import {
  circuitChatApi,
  fetchCircuitModelsApi,
  listAgentChatsApi,
  saveAgentChatApi,
  deleteAgentChatApi,
  type AgentChat,
  type AgentChatMessage,
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
    'Hello! I am your project assistant powered by Featherless.\n\nAsk me about your current project, firmware, or connected device, and I will help you work through it.',
  timestamp: new Date(),
}

const GENERATION_STEPS = ['Building', 'Wiring', 'Powering', 'Polishing']

function toApiMessages(messages: MessageItem[]): AgentChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    actions: message.actions,
    timestamp: message.timestamp.toISOString(),
  }))
}

function fromApiMessages(messages: AgentChatMessage[]): MessageItem[] {
  return messages.map((message) => ({
    ...message,
    timestamp: new Date(message.timestamp),
  }))
}

export const AIChatView: React.FC<AIChatViewProps> = ({ onNavigateToStudio, compact = false }) => {
  const circuitState = useCircuitStore()
  const [currentPid, setCurrentPid] = useState<string>(circuitState.projectId || '')
  const [models, setModels] = useState<Array<{ id: string; name: string; units: number }>>([])
  const [selectedModel, setSelectedModel] = useState<string>('deepseek-ai/DeepSeek-V3.2')
  const [inputMessage, setInputMessage] = useState('')
  const [vineMentioned, setVineMentioned] = useState(false)
  const [loading, setLoading] = useState(false)
  const [recentChats, setRecentChats] = useState<AgentChat[]>([])
  const [currentChatId, setCurrentChatId] = useState<string | null>(null)
  const [chatToDelete, setChatToDelete] = useState<AgentChat | null>(null)
  const [chatDeleteError, setChatDeleteError] = useState<string | null>(null)
  const [generationStep, setGenerationStep] = useState(GENERATION_STEPS[0])
  const [messages, setMessages] = useState<MessageItem[]>([WELCOME_MESSAGE])

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

  // Load recent chats from the database when the active project changes.
  useEffect(() => {
    if (!currentPid) return
    let cancelled = false
    listAgentChatsApi(currentPid).then(({ chats }) => {
      if (cancelled) return
      setRecentChats(chats)
      const latest = chats[0]
      setCurrentChatId(latest?.chatId || null)
      setMessages(latest?.messages?.length ? fromApiMessages(latest.messages) : [WELCOME_MESSAGE])
    }).catch(() => {
      if (!cancelled) {
        setRecentChats([])
        setCurrentChatId(null)
        setMessages([WELCOME_MESSAGE])
      }
    })
    return () => { cancelled = true }
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

  const handleNewChat = async () => {
    const pid = getActiveProject()
    if (!pid || loading) return
    try {
      const result = await saveAgentChatApi({
        projectId: pid,
        title: 'New Chat',
        messages: toApiMessages([WELCOME_MESSAGE]),
      })
      setCurrentChatId(result.chat.chatId)
      setRecentChats((prev) => [result.chat, ...prev.filter((chat) => chat.chatId !== result.chat.chatId)])
      setMessages([WELCOME_MESSAGE])
      setInputMessage('')
    } catch {
      setMessages([{
        ...WELCOME_MESSAGE,
        content: 'Unable to create a new chat right now. Please try again.',
      }])
    }
  }

  const handleSelectChat = (chatId: string) => {
    const chat = recentChats.find((item) => item.chatId === chatId)
    if (!chat) return
    setCurrentChatId(chat.chatId)
    setMessages(chat.messages.length ? fromApiMessages(chat.messages) : [WELCOME_MESSAGE])
  }

  const handleDeleteChat = async () => {
    if (!chatToDelete) return
    setChatDeleteError(null)
    try {
      await deleteAgentChatApi(chatToDelete.chatId)
      const remaining = recentChats.filter((chat) => chat.chatId !== chatToDelete.chatId)
      setRecentChats(remaining)
      const nextChat = remaining[0]
      setCurrentChatId(nextChat?.chatId || null)
      setMessages(nextChat?.messages?.length ? fromApiMessages(nextChat.messages) : [WELCOME_MESSAGE])
      setChatToDelete(null)
    } catch (error) {
      setChatDeleteError(error instanceof Error ? error.message : 'Unable to delete chat.')
    }
  }

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend || inputMessage).trim()
    if (!text || loading) return

    const pid = getActiveProject()
    if (!pid) {
      setMessages((prev) => [...prev, {
        id: Math.random().toString(36).substring(2, 9),
        role: 'assistant',
        content: 'Open a project first so I can help with it.',
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

    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setLoading(true)

    try {
      // Convert history for API
      const history: ChatMessage[] = nextMessages
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
          content: res.reply || 'Project updated successfully.',
          actions: res.actions || [],
          timestamp: new Date(),
        }
        const completedMessages = [...nextMessages, assistantMsg]
        setMessages(completedMessages)
        const savedChat = await saveAgentChatApi({
          chatId: currentChatId || undefined,
          projectId: pid,
          messages: toApiMessages(completedMessages),
        })
        setCurrentChatId(savedChat.chat.chatId)
        setRecentChats((prev) => [savedChat.chat, ...prev.filter((chat) => chat.chatId !== savedChat.chat.chatId)])

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
          content: `Error: ${res?.error || 'I could not process that request. Please try again.'}`,
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
                Project Assistant
                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                  Featherless
                </span>
              </h2>
              <p className="text-[11px] text-slate-500">Project and device assistance</p>
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

            {/* New Chat Button */}
            <button
              onClick={() => void handleNewChat()}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-500 hover:text-rose-600 bg-slate-50 hover:bg-rose-50 rounded-lg border border-slate-200 hover:border-rose-200 transition cursor-pointer"
              title="Start a new database-backed chat"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" />
              </svg>
              New Chat
            </button>

            {/* Open project workspace */}
            {onNavigateToStudio && (
              <button
                onClick={() => onNavigateToStudio(currentPid)}
                className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-200 transition cursor-pointer"
              >
                <svg className="w-3.5 h-3.5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M9 9h6v6H9z" />
                </svg>
                Open Project
              </button>
            )}
          </div>
        </div>
      )}

      {compact && (
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-2.5 py-2">
          <select
            value={currentChatId || ''}
            onChange={(event) => handleSelectChat(event.target.value)}
            disabled={recentChats.length === 0}
            aria-label="Recent chats"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600 outline-hidden focus:border-slate-400"
          >
            {recentChats.length === 0 && <option value="">Recent Chat</option>}
            {recentChats.length > 0 && <option value="" disabled>Recent Chat</option>}
            {recentChats.map((chat) => (
              <option key={chat.chatId} value={chat.chatId}>{chat.title}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              const chat = recentChats.find((item) => item.chatId === currentChatId)
              if (chat) {
                setChatDeleteError(null)
                setChatToDelete(chat)
              }
            }}
            disabled={!currentChatId || loading}
            aria-label="Delete selected chat"
            title="Delete selected chat"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M10 11v6M14 11v6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => void handleNewChat()}
            disabled={!currentPid || loading}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            title="Start a new database-backed chat"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" />
            </svg>
            New Chat
          </button>
        </div>
      )}

      {chatToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h2 className="text-sm font-bold text-slate-800">Delete chat?</h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              Delete <span className="font-semibold text-slate-700">{chatToDelete.title}</span>? This cannot be undone.
            </p>
            {chatDeleteError && <p className="mt-3 rounded-md bg-rose-50 px-2.5 py-2 text-xs text-rose-700">{chatDeleteError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setChatToDelete(null)}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteChat()}
                className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-700"
              >
                Delete
              </button>
            </div>
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
                    Activity ({msg.actions.length})
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
              <span className="grid h-4 w-4 place-items-center rounded-sm bg-slate-800 text-[8px] font-bold text-white">P</span>
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
