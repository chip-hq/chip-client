/**
 * Client side of the OLED component registry.
 * Imports schemas/defaults/rules from the shared module
 * (`backend/oled-components.js`, also imported by Node) and adds
 * browser-only concerns: toolbar icons, SVG renderers, canvas text
 * measurement, and patches with auto-fit side effects.
 */
import {
  COMPONENTS,
  getComponent,
  defaultElement,
  eyePupils,
  FONT_SIZES,
} from '../../../backend/oled-components.js';
import type {
  ComponentDef,
  DesignElementFields,
  OledDisplaySize,
  PropDescriptor,
} from '../../../backend/oled-components.js';

export { COMPONENTS, getComponent, defaultElement, eyePupils };
export type { ComponentDef, DesignElementFields, OledDisplaySize, PropDescriptor };

/** Toolbar order. Every entry renders one icon button from the registry. */
export const TOOLBAR_ORDER = [
  'text',
  'rectangle',
  'filledRectangle',
  'circle',
  'line',
  'eyes',
  'marquee',
  'teleprompter',
] as const;

/** Icon per registry `icon` key. */
export const ICONS: Record<string, React.ReactNode> = {
  text: <span className="font-mono text-[15px] font-bold">T</span>,
  rectangle: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="6" width="16" height="12" rx="1" /></svg>
  ),
  filledRectangle: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="6" width="16" height="12" rx="1" /></svg>
  ),
  circle: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="7" /></svg>
  ),
  line: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 19 19 5" /></svg>
  ),
  eyes: (
    <svg width="18" height="16" viewBox="0 0 24 20" fill="currentColor"><ellipse cx="6.5" cy="10" rx="4" ry="6.5" /><ellipse cx="17.5" cy="10" rx="4" ry="6.5" /></svg>
  ),
  marquee: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h16" /><path d="m13 6 6 6-6 6" /><path d="M3 7v10" opacity="0.45" /></svg>
  ),
  teleprompter: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V8" /><path d="m6 12 6-6 6 6" /><path d="M5 4h14" /></svg>
  ),
};

export function fontSizeOf(font: string | undefined): number {
  return (FONT_SIZES as Record<string, number>)[font ?? ''] ?? 6;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
export function estimateTextWidth(text: string, font: string | undefined): number {
  const size = fontSizeOf(font);
  try {
    if (measureCtx === undefined) {
      measureCtx = document.createElement('canvas').getContext('2d');
    }
    if (measureCtx) {
      measureCtx.font = `${size}px monospace`;
      const w = measureCtx.measureText(text || '').width;
      if (Number.isFinite(w) && w > 0) return w;
    }
  } catch { /* fall through to estimate */ }
  return (text || '').length * size * 0.6;
}

export function clampPad(v: unknown): number {
  return Number.isFinite(Number(v)) ? Math.max(0, Math.min(10, Math.round(Number(v)))) : 2;
}

function lineHeightOf(font: string): number {
  return font === '8x8' ? 8 : font === '5x7' ? 7 : 8;
}

/** Text scale multiplier (Adafruit setTextSize equivalent), 1–8. */
export function scaleOf(element: DesignElementFields): number {
  const s = Number(element.size);
  if (!Number.isFinite(s)) return 1;
  return Math.max(1, Math.min(8, Math.round(s)));
}

/**
 * Word-wrap text to a pixel boundary. Long words hard-break (1-bit OLEDs
 * don't hyphenate). Explicit \n always breaks. Returns visual lines.
 */
export function wrapText(text: string, font: string, maxWidth: number, scale = 1): { lines: string[]; lineH: number } {
  const boundary = Math.max(8, maxWidth);
  const lineH = lineHeightOf(font) * scale;
  const fits = (s: string) => estimateTextWidth(s, font) * scale <= boundary;
  const lines: string[] = [];
  const paragraphs = (text ?? '').split('\n');
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let cur = '';
    for (const word of words) {
      let rest = word;
      while (rest.length > 0 && !fits(rest)) {
        if (cur !== '') {
          lines.push(cur);
          cur = '';
        }
        const est = Math.max(1, estimateTextWidth(rest, font));
        let k = Math.max(1, Math.floor((rest.length * boundary) / est));
        while (k > 1 && !fits(rest.slice(0, k))) k -= 1;
        lines.push(rest.slice(0, k));
        rest = rest.slice(k);
      }
      if (rest.length === 0) continue;
      const trial = cur !== '' ? `${cur} ${rest}` : rest;
      if (fits(trial)) {
        cur = trial;
      } else {
        if (cur !== '') lines.push(cur);
        cur = rest;
      }
    }
    if (cur !== '') lines.push(cur);
  }
  if (lines.length === 0) lines.push('');
  return { lines, lineH };
}

/**
 * Frame metrics for a text element. Single line hugs the content;
 * longer copy wraps at the frame width and the height follows the lines.
 * Only plain text wraps — marquee stays a single scrolling line.
 */
export function textFitBox(element: DesignElementFields): { width: number; height: number; fontSize: number; ox: number; oy: number; lines: string[]; lineH: number } {
  const font = typeof element.font === 'string' ? element.font : '6x8';
  const scale = scaleOf(element);
  const fontSize = fontSizeOf(font) * scale;
  const pad = element.invert === true ? clampPad(element.invertPadding) : 0;
  const text = typeof element.text === 'string' ? element.text : '';
  if (element.type !== 'text') {
    const height = lineHeightOf(font) * scale + pad * 2;
    const width = Math.max(8, Math.ceil(estimateTextWidth(text, font) * scale + 1.5)) + pad * 2;
    return { width, height, fontSize, ox: -pad, oy: -pad, lines: [text], lineH: lineHeightOf(font) * scale };
  }
  const boundary = Math.max(8, num(element.width) || 64);
  const wrapped = wrapText(text, font, boundary, scale);
  if (wrapped.lines.length <= 1) {
    const width = Math.max(8, Math.ceil(estimateTextWidth(text, font) * scale + 1.5)) + pad * 2;
    return { width, height: wrapped.lineH + pad * 2, fontSize, ox: -pad, oy: -pad, lines: wrapped.lines, lineH: wrapped.lineH };
  }
  return { width: boundary, height: wrapped.lines.length * wrapped.lineH + pad * 2, fontSize, ox: -pad, oy: -pad, lines: wrapped.lines, lineH: wrapped.lineH };
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export interface RenderAnim {
  playing: boolean;
  playMs: number;
  /** Prefix for clipPath ids so canvas/preview/thumbnail never collide. */
  idPrefix: string;
  /** Background color behind the element — inverted text is drawn in this color. */
  paper?: string;
}

/**
 * Render any registered element. The canvas render loop calls this per
 * element per frame instead of switching on type — new registry entries
 * render with zero canvas changes (plus an icon for the toolbar).
 */
export function renderSvg(
  element: DesignElementFields,
  color: string,
  anim?: RenderAnim,
): React.ReactNode {
  const x = num(element.x);
  const y = num(element.y);
  const w = num(element.width);
  const h = num(element.height);
  const font = str(element.font, '6x8');
  const scale = scaleOf(element);
  const fs = fontSizeOf(font) * scale;
  const playing = anim?.playing ?? false;
  const playMs = anim?.playMs ?? 0;
  const prefix = anim?.idPrefix ?? 'static';

  if (element.type === 'text') {
    const text = str(element.text);
    const inverted = element.invert === true;
    const pad = inverted ? clampPad(element.invertPadding) : 0;
    const paper = anim?.paper ?? '#ffffff';
    // Natural glyph widths always — short text never justifies to the frame.
    const wrapped = wrapText(text, font, Math.max(8, w), scale);
    if (wrapped.lines.length > 1) {
      // Wrapped copy: frame width is the wrap boundary, lines stack left-aligned.
      return (
        <g>
          {inverted && <rect x={x - pad} y={y - pad} width={w} height={h} fill={color} />}
          <g fontFamily="monospace" fontSize={fs} fill={inverted ? paper : color}>
            {wrapped.lines.map((ln, i) => <text key={i} x={x} y={y + 7 * scale + i * wrapped.lineH}>{ln}</text>)}
          </g>
        </g>
      );
    }
    if (inverted) {
      return (
        <g>
          <rect x={x - pad} y={y - pad} width={w} height={h} fill={color} />
          <text x={x} y={y + 7 * scale} fontSize={fs} fontFamily="monospace" fill={paper}>{text}</text>
        </g>
      );
    }
    return <text x={x} y={y + 7 * scale} fontSize={fs} fontFamily="monospace" fill={color}>{text}</text>;
  }

  if (!playing && element.type === 'marquee') {
    return <text x={x} y={y + 7 * scale} fontSize={fs} fontFamily="monospace" fill={color}>{str(element.text)}</text>;
  }

  if (element.type === 'marquee' && playing) {
    const text = str(element.text);
    const textW = Math.max(8, estimateTextWidth(text, font) * scale);
    const speed = num(element.speed, 24) || 24;
    const span = textW + 16;
    const off = ((playMs / 1000) * speed) % span;
    const left = (element.direction ?? 'left') === 'left';
    const start = (left ? x - off : x - span + off) - span;
    const clipId = `${prefix}-mq-${str(element.id, 'x')}`;
    return (
      <g>
        <defs><clipPath id={clipId}><rect x={x} y={y} width={w} height={Math.max(h, 8)} /></clipPath></defs>
        <g clipPath={`url(#${clipId})`} fontFamily="monospace" fontSize={fs} fill={color}>
          {[0, 1, 2, 3].map((k) => <text key={k} x={start + k * span} y={y + 7 * scale}>{text}</text>)}
        </g>
      </g>
    );
  }

  if (element.type === 'teleprompter') {
    const lines = str(element.text).split('\n');
    const lineH = (fontSizeOf(font) + 3) * scale;
    if (!playing) {
      return (
        <g fill={color} fontFamily="monospace" fontSize={fs}>
          {lines.map((line, i) => <text key={i} x={x} y={y + fs + i * lineH}>{line}</text>)}
        </g>
      );
    }
    const totalH = Math.max(lineH, lines.length * lineH);
    const speed = num(element.speed, 10) || 10;
    const travel = totalH + h;
    const off = ((playMs / 1000) * speed) % travel;
    const up = (element.direction ?? 'up') === 'up';
    const clipId = `${prefix}-tp-${str(element.id, 'x')}`;
    return (
      <g>
        <defs><clipPath id={clipId}><rect x={x} y={y} width={w} height={Math.max(h, 8)} /></clipPath></defs>
        <g clipPath={`url(#${clipId})`} fill={color} fontFamily="monospace" fontSize={fs}>
          {lines.map((line, i) => {
            const ly = up
              ? y + h - off + i * lineH + fs * 0.2
              : y - totalH + off + i * lineH + fs * 0.2;
            return <text key={i} x={x} y={ly}>{line}</text>;
          })}
        </g>
      </g>
    );
  }

  if (element.type === 'eyes') {
    const blinkPeriod = 4200;
    const blinkLen = 180;
    const ph = playing ? playMs % blinkPeriod : -1;
    const inBlink = ph >= 0 && ph < blinkLen;
    const blink = inBlink ? 1 - 0.9 * Math.sin((ph / blinkLen) * Math.PI) : 1;
    const look = playing ? Math.sin(playMs / 1400) * Math.min(2.5, w * 0.025) : 0;
    return (
      <g fill={color}>
        {eyePupils({ ...element, gap: element.gap }).map((p, i) => (
          <ellipse key={i} cx={p.cx + look} cy={p.cy} rx={p.rx} ry={Math.max(1, p.ry * blink)} />
        ))}
      </g>
    );
  }

  if (element.type === 'rectangle' || element.type === 'filledRectangle') {
    const filled = element.type === 'filledRectangle' || element.fill === true;
    return <rect x={x} y={y} width={w} height={h} fill={filled ? color : 'none'} stroke={color} strokeWidth="0.8" />;
  }
  if (element.type === 'circle') {
    return <circle cx={x + w / 2} cy={y + h / 2} r={Math.min(w, h) / 2} fill={element.fill === true ? color : 'none'} stroke={color} strokeWidth="0.8" />;
  }
  if (element.type === 'line') {
    return <line x1={x} y1={y} x2={x + w} y2={y + h} stroke={color} strokeWidth="0.8" />;
  }
  return null;
}

/**
 * Patch builder for the generic properties panel: text edits on plain
 * text elements keep the frame fitted (never collapsing a user stretch).
 * Everything else writes through directly.
 */
export function patchElement(
  element: DesignElementFields,
  key: string,
  value: string | number | boolean,
  display: OledDisplaySize,
): Record<string, string | number | boolean> {
  if (element.type === 'text' && (key === 'text' || key === 'font' || key === 'size')) {
    const next = { ...element, [key]: value };
    const font = typeof next.font === 'string' ? next.font : '6x8';
    const text = typeof next.text === 'string' ? next.text : '';
    const scale = scaleOf(next);
    const pad = next.invert === true ? clampPad(next.invertPadding) : 0;
    const boundary = Math.max(8, num(element.width) || 64);
    const wrapped = wrapText(text, font, boundary, scale);
    if (wrapped.lines.length > 1) {
      // Copy outgrew the frame: keep the wrap boundary, grow the height.
      return {
        [key]: value,
        width: Math.min(boundary, display.width),
        height: wrapped.lines.length * wrapped.lineH + pad * 2,
      };
    }
    const fitH = lineHeightOf(font) * scale + pad * 2;
    const fitW = Math.max(8, Math.ceil(estimateTextWidth(text, font) * scale + 1.5)) + pad * 2;
    return {
      [key]: value,
      width: Math.min(Math.max(fitW, num(element.width)), display.width),
      height: Math.max(fitH, num(element.height)),
    };
  }
  if (element.type === 'text' && key === 'invert') {
    const turningOn = value === true;
    const pad = clampPad(element.invertPadding);
    const font = typeof element.font === 'string' ? element.font : '6x8';
    const text = typeof element.text === 'string' ? element.text : '';
    const scale = scaleOf(element);
    const fitH = lineHeightOf(font) * scale + (turningOn ? pad * 2 : 0);
    const fitW = Math.max(8, Math.ceil(estimateTextWidth(text, font) * scale + 1.5)) + (turningOn ? pad * 2 : 0);
    // Grow into the block when turning on; relax back toward the letters when off.
    const baseW = turningOn ? num(element.width) : Math.max(1, num(element.width) - pad * 2);
    const baseH = turningOn ? num(element.height) : Math.max(1, num(element.height) - pad * 2);
    return {
      invert: turningOn,
      width: Math.min(Math.max(fitW, baseW), display.width),
      height: Math.max(fitH, baseH),
    };
  }
  return { [key]: value };
}
