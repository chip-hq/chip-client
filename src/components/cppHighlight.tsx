/**
 * Minimal C++ syntax highlighter (no dependencies) + overlay code pane.
 *
 * CodePane renders a highlighted <pre> with a transparent <textarea> on top
 * (identical font metrics), so editing feels like a real IDE while staying
 * dependency-free and theme-controlled.
 */
import { useRef } from 'react'

const KEYWORDS = new Set(
  'alignas alignof and and_eq asm auto bitand bitor bool break case catch char char8_t char16_t char32_t class compl concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq nullptr_t'.split(' '),
)

interface Token {
  text: string
  cls: string | null
}

const C_COMMENT = '#6a9955'
const C_STRING = '#ce9178'
const C_KEYWORD = '#569cd6'
const C_NUMBER = '#b5cea8'
const C_PREPROC = '#c586c0'
const C_FUNC = '#dcdcaa'
const C_PLAIN = '#e5e5e5'

export function tokenizeCpp(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = src.length
  const push = (text: string, cls: string | null) => {
    if (!text) return
    const last = tokens[tokens.length - 1]
    if (last && last.cls === cls) last.text += text
    else tokens.push({ text, cls })
  }

  while (i < n) {
    const c = src[i]
    // line comment
    if (c === '/' && src[i + 1] === '/') {
      let j = i + 2
      while (j < n && src[j] !== '\n') j++
      push(src.slice(i, j), C_COMMENT)
      i = j
      continue
    }
    // block comment
    if (c === '/' && src[i + 1] === '*') {
      let j = i + 2
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++
      j = Math.min(n, j + 2)
      push(src.slice(i, j), C_COMMENT)
      i = j
      continue
    }
    // string / char literal
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === c || src[j] === '\n') { j++; break }
        j++
      }
      push(src.slice(i, j), C_STRING)
      i = j
      continue
    }
    // preprocessor to end of line
    if (c === '#' && (i === 0 || src[i - 1] === '\n' || /^\s*$/.test(src.slice(src.lastIndexOf('\n', i - 1) + 1, i)))) {
      let j = i
      while (j < n && src[j] !== '\n') j++
      push(src.slice(i, j), C_PREPROC)
      i = j
      continue
    }
    // number
    if (/[0-9]/.test(c) && (i === 0 || /[^0-9a-zA-Z_.]/.test(src[i - 1]))) {
      const m = /^[0-9][0-9a-zA-Z_.']*/.exec(src.slice(i))
      push(m![0], C_NUMBER)
      i += m![0].length
      continue
    }
    // identifier / keyword / function call
    if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i))
      const word = m![0]
      let k = i + word.length
      while (src[k] === ' ' || src[k] === '\t') k++
      if (KEYWORDS.has(word)) push(word, C_KEYWORD)
      else if (src[k] === '(') push(word, C_FUNC)
      else push(word, C_PLAIN)
      i += word.length
      continue
    }
    push(c, null)
    i++
  }
  return tokens
}

export function HighlightedCode({ code }: { code: string }) {
  const tokens = tokenizeCpp(code)
  return (
    <>
      {tokens.map((t, i) =>
        t.cls ? (
          <span key={i} style={{ color: t.cls }}>{t.text}</span>
        ) : (
          <span key={i}>{t.text}</span>
        ),
      )}
    </>
  )
}

const PANE_STYLE = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 12,
  lineHeight: '20px',
} as const

interface CodePaneProps {
  value: string
  onChange?: (v: string) => void
  readOnly?: boolean
  placeholder?: string
}

/** Editable (or read-only) code pane with line numbers + C++ highlight. */
export function CodePane({ value, onChange, readOnly = false, placeholder }: CodePaneProps) {
  const gutterRef = useRef<HTMLDivElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const lines = value === '' ? 1 : value.split('\n').length

  const onScroll = () => {
    const top = areaRef.current?.scrollTop ?? preRef.current?.scrollTop ?? 0
    const left = areaRef.current?.scrollLeft ?? preRef.current?.scrollLeft ?? 0
    if (gutterRef.current) gutterRef.current.scrollTop = top
    if (preRef.current) {
      preRef.current.scrollTop = top
      preRef.current.scrollLeft = left
    }
  }

  return (
    <div className="flex grow overflow-hidden min-w-0 min-h-0" style={{ background: '#1e1e1e' }}>
      <div
        ref={gutterRef}
        className="text-right px-2 py-3 select-none overflow-hidden shrink-0"
        style={{ ...PANE_STYLE, background: '#181818', color: '#737373', minWidth: 48 }}
        aria-hidden="true"
      >
        {Array.from({ length: lines }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <div className="relative grow overflow-hidden">
        <pre
          ref={preRef}
          aria-hidden="true"
          className="absolute inset-0 m-0 px-3 py-3 overflow-auto whitespace-pre"
          style={{ ...PANE_STYLE, color: C_PLAIN }}
        >
          <HighlightedCode code={value || ' '} />
          {value === '' && placeholder && <span style={{ color: '#525252' }}>{placeholder}</span>}
        </pre>
        {!readOnly && (
          <textarea
            ref={areaRef}
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            onScroll={onScroll}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="absolute inset-0 px-3 py-3 outline-none resize-none overflow-auto whitespace-pre"
            style={{ ...PANE_STYLE, background: 'transparent', color: 'transparent', caretColor: '#e5e5e5' }}
          />
        )}
      </div>
    </div>
  )
}
