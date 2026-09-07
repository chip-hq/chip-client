import { useState, useRef, useEffect } from 'react'

export interface DropdownOption {
  value: string
  label: string
  hint?: string
}

interface CleanDropdownProps {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  size?: 'sm' | 'md'
  align?: 'left' | 'right'
  className?: string
}

/**
 * A clean, professional single-select dropdown that replaces the native
 * <select> element. Neutral slate palette, keyboard accessible, closes on
 * outside click. Used for the Project picker and AI Model selector.
 */
export function CleanDropdown({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = 'Select…',
  size = 'sm',
  align = 'left',
  className = '',
}: CleanDropdownProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = options.find((o) => o.value === value)
  const triggerPad = size === 'sm' ? 'h-7 px-2.5 text-[11px]' : 'h-8 px-3 text-xs'

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 ${triggerPad} font-semibold text-slate-700 bg-white border rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default w-full ${
          open ? 'border-slate-400 shadow-xs' : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        <span className="truncate flex-1 text-left">
          {selected ? selected.label : <span className="text-slate-400 font-medium">{placeholder}</span>}
        </span>
        <svg
          className={`w-3 h-3 text-slate-400 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-1 min-w-full w-max max-w-[280px] bg-white border border-slate-200 rounded-lg shadow-xl p-1 max-h-64 overflow-y-auto animate-in fade-in-0 zoom-in-95 duration-100 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {options.length === 0 ? (
            <div className="px-2.5 py-1.5 text-[11px] text-slate-400">No options</div>
          ) : (
            options.map((opt) => {
              const active = opt.value === value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value)
                    setOpen(false)
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-colors cursor-pointer ${
                    active ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-[11px] font-semibold truncate">{opt.label}</span>
                    {opt.hint && <span className="block text-[10px] text-slate-400 truncate">{opt.hint}</span>}
                  </span>
                  {active && (
                    <svg className="w-3.5 h-3.5 text-slate-900 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
