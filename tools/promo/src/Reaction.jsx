// "Different Worlds by Hilads", reaction + ranking format (Admin › Worlds, DwReaction):
// a silent 1080×1920 video. 0 to 7 s, the table screen: a light ranking card (TableScreen, below); 7 to 10 s,
// the closing slide: the clip keeps playing behind, blurred and darkened, the #1's flag, the question in a big
// tilted speech bubble (Baloo 2) that pops in with a bounce, the series mark and hilads.live; a fast zoom between
// the two. Without a question: the table screen alone, 8 s.
// worlds.mjs renders the video and two PNGs (carousels): 01 the table screen, 02 the closing slide.

import { AbsoluteFill, Img, Loop, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from '@remotion/fonts';
import { flagColor } from './flagColors.js';

const BG = '#16110D';
const ACCENT = '#FF7A3D';
const FONT = 'Be Vietnam Pro';
const LEFT = 72;
const RIGHT = 1080 - 72;
// The closing slide's question: a speech bubble (accent, white text, a tail down-left, tilted) in a rounder,
// playful font (Baloo 2, Be Vietnam Pro as the fallback), as big as fits in up to 3 lines.
const Q_FONT = 'Baloo 2';
const Q_MAX_PX = 132;
const Q_MIN_PX = 64;
const Q_TEXT_W = 820;                     // the bubble's text width at most (safe margins, the apps' side buttons)
const Q_PAD_X = 46;
const Q_PAD_Y = 26;
const Q_TILT = -2;

for (const [file, weight] of [['SemiBold', '600'], ['Bold', '700'], ['ExtraBold', '800']]) {
  loadFont({ family: FONT, url: staticFile(`fonts/BeVietnamPro-${file}.ttf`), weight });
}
loadFont({ family: Q_FONT, url: staticFile('fonts/Baloo2-Variable.ttf'), weight: '400 800' });

import { TABLE_SECONDS, ZOOM_FRAMES as ZOOM, reactionSeconds } from './reactionTiming.js';
export { reactionSeconds };

let ctx = null;
function measure(text, px, weight = 800, family = FONT) {
  ctx ??= document.createElement('canvas').getContext('2d');
  ctx.font = `${weight} ${px}px "${family}", "${FONT}"`;
  return ctx.measureText(text).width;
}

/** The biggest size from max down to min where the text fits on one line. */
function fitSize(text, max, min, weight = 800, width = RIGHT - LEFT) {
  for (let px = max; px > min; px -= 1) {
    if (measure(text, px, weight) <= width) return px;
  }
  return min;
}

/**
 * props: {headline, detail, rows: [{rank, country, flag (file in public/flags or null), emoji (the flag emoji: its color), value,
 * unit, gap_before?, highlight?}], source, highlight: [country], clip: {src, seconds, credit} | null, valueFormat,
 * cardBg (a theme name or a light #rrggbb, cream by default), accent (the headline's words in terracotta)}. gap_before: a "…" separator above the row (the
 * ranking skips to it); highlight: that row in the accent color too (e.g. a reference country).
 */
export function ReactionRanking({ question = null, still = false, ...props }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const q = (question ?? '').trim();
  const T = Math.round(TABLE_SECONDS * fps);
  if (!q) return <TableScreen {...props} />;
  // The fast zoom: the table grows and goes, the closing slide comes in from a little bigger.
  const out = interpolate(frame, [T - ZOOM, T], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const inn = interpolate(frame, [T - 2, T + ZOOM - 2], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: BG }}>
      {frame < T + ZOOM && (
        <AbsoluteFill style={{ opacity: 1 - out, transform: `scale(${1 + 0.12 * out})` }}><TableScreen {...props} /></AbsoluteFill>
      )}
      {frame >= T - 2 && (
        <AbsoluteFill style={{ opacity: inn, transform: `scale(${1.1 - 0.1 * inn})` }}>
          <ClosingSlide question={q} clip={props.clip} first={props.rows?.[0] ?? null} from={T} still={still} />
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
}

/** The clip, playing at its speed from the video's start, looping when it ends (the same timing on both scenes). */
function ClipLoop({ clip, style }) {
  const { fps } = useVideoConfig();
  return (
    <Loop durationInFrames={Math.max(1, Math.floor(clip.seconds * fps))}>
      <OffthreadVideo src={staticFile(clip.src)} muted style={style} />
    </Loop>
  );
}

/** The question wrapped for the bubble: the biggest size (Q_MAX_PX to Q_MIN_PX) where it fits in 1 to 3 lines. */
function bubbleLines(text) {
  for (let px = Q_MAX_PX; px >= Q_MIN_PX; px -= 2) {
    for (const max of [1, 2, 3]) {
      const lines = [];
      let line = '';
      let ok = true;
      for (const word of text.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (measure(next, px, 800, Q_FONT) <= Q_TEXT_W) line = next;
        else if (!line) { ok = false; break; }
        else { lines.push(line); line = word; }
      }
      if (line) lines.push(line);
      // Never leave an emoji or a lone short word alone on the last line.
      if (ok && lines.length <= max && !(lines.length > 1 && lines[lines.length - 1].length <= 3)) return { px, lines };
    }
  }
  return { px: Q_MIN_PX, lines: [text] };
}

/** The closing slide: the blurred clip, the #1's flag, the question's bubble, the series mark. */
function ClosingSlide({ question, clip, first, from, still }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = still ? 1 : spring({ frame: frame - from - 3, fps, config: { damping: 7, stiffness: 220, mass: 0.6 } });
  const { px, lines } = bubbleLines(question);
  const lineH = px * 1.06;
  const w = Math.max(...lines.map((l) => measure(l, px, 800, Q_FONT))) + 2 * Q_PAD_X;
  const h = lines.length * lineH + 2 * Q_PAD_Y;
  const tail = Math.round(px * 0.42);
  const flag = first?.flag ? first.flag : null;
  // The group (flag, bubble, mark), a little above the middle (the apps' captions cover the bottom).
  const flagS = 96, markH = 120, gap = 46;
  const total = (flag ? flagS + gap : 0) + h + tail + gap + markH;
  const top0 = Math.max(220, 900 - total / 2);
  const bubbleTop = top0 + (flag ? flagS + gap : 0);
  return (
    <AbsoluteFill style={{ background: '#000', overflow: 'hidden' }}>
      {clip && (
        <div style={{ position: 'absolute', inset: 0, transform: 'scale(1.12)', filter: 'blur(24px) brightness(0.6) saturate(1.15)' }}>
          <ClipLoop clip={clip} style={{ width: 1080, height: 1920, objectFit: 'cover' }} />
        </div>
      )}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(22,17,13,0.28)' }} />
      {flag && (
        <Img src={staticFile(flag)} style={{ position: 'absolute', left: (1080 - flagS) / 2, top: top0, width: flagS, height: flagS,
                                              opacity: still ? 1 : Math.min(1, pop * 1.6) }} />
      )}
      <div style={{ position: 'absolute', left: (1080 - w) / 2, top: bubbleTop, width: w, height: h + tail,
                    transformOrigin: '22% 100%', opacity: still ? 1 : Math.min(1, pop * 2),
                    transform: `rotate(${Q_TILT}deg) scale(${still ? 1 : 0.55 + 0.45 * pop})` }}>
        <div style={{ height: h, borderRadius: Math.min(h * 0.38, 70), background: ACCENT, display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', boxShadow: '0 16px 44px rgba(0,0,0,0.45)' }}>
          {lines.map((l, i) => (
            <div key={i} style={{ fontFamily: `"${Q_FONT}", "${FONT}"`, fontWeight: 800, fontSize: px, lineHeight: `${lineH}px`, color: '#fff',
                                  whiteSpace: 'nowrap', paddingTop: px * 0.1 }}>{l}</div>
          ))}
        </div>
        {/* The tail, down-left: the bubble talks to the viewer. */}
        <svg width={tail * 1.7} height={tail + 2} style={{ position: 'absolute', left: w * 0.18, top: h - 1 }}>
          <path d={`M0 0 L${tail * 1.7} 0 L${tail * 0.12} ${tail} Z`} fill={ACCENT} />
        </svg>
      </div>
      <div style={{ position: 'absolute', left: 0, width: 1080, top: bubbleTop + h + tail + gap, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: 14, fontFamily: FONT, opacity: still ? 1 : interpolate(frame, [from + 6, from + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Img src={staticFile('logo.svg')} style={{ width: 56, height: 56 }} />
          <div style={{ fontSize: 30 }}><span style={{ fontWeight: 800, letterSpacing: 3, color: ACCENT }}>DIFFERENT WORLDS</span> <span style={{ fontWeight: 600, color: '#fff' }}>by Hilads</span></div>
        </div>
        <div style={{ fontSize: 30, fontWeight: 600, color: 'rgba(255,255,255,0.92)' }}>Compare your city on <span style={{ fontWeight: 800, color: ACCENT }}>hilads.live</span></div>
      </div>
    </AbsoluteFill>
  );
}

// ── The table screen: a light, playful ranking card ───────────────────────────────────────────────
// The clip on top with a wavy edge into the card's color, the detail as a tilted yellow sticker on it, the headline
// (its accent words in terracotta), a podium for the top 3 (#1 in the middle, the flags' colors), then #4 and after
// as white rounded rows with a bar in the country's flag color, and the footer: the question, hilads.live, the source.
// Everything that matters stays out of the apps' side buttons (right) and away from the top bar.

const INK = '#2B1A12';
const MUTED = '#8A6E5C';
const TERRA = '#C24E1C';
const STICKER = '#FFC93C';
const CARD_THEMES = { cream: '#FFF6E9', yellow: '#FFEDB8', green: '#E2F0DA', pink: '#FFE4DC', blue: '#E1EDFF' };
const C_LEFT = 56;
const C_RIGHT = 944;                      // rows, podium and footer: the apps' buttons are on the right
const T_RIGHT = 1024;                     // the headline (above the buttons)
const FOOT_TOP = 1650;
const TITLE_MAX = 64;
const TITLE_MIN = 44;
const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };
const ASK = "What's YOUR country's answer? 🌍";

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mix = (hex, to, t) => `rgb(${hexRgb(hex).map((c, i) => Math.round(c + (hexRgb(to)[i] - c) * t)).join(',')})`;
const luminance = (hex) => { const [r, g, b] = hexRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

/** The card's background: a theme name (cream, yellow, green, pink, blue) or a light #rrggbb; cream by default. */
export function cardColor(bg) {
  const v = String(bg ?? '').trim().toLowerCase();
  if (CARD_THEMES[v]) return CARD_THEMES[v];
  return /^#[0-9a-f]{6}$/.test(v) && luminance(v) >= 0.6 ? v : CARD_THEMES.cream;
}

/** Words of a text, each marked when inside the accent phrase (case-insensitive, its first occurrence). */
function accentWords(text, accent) {
  const a = (accent ?? '').trim();
  const at = a ? text.toLowerCase().indexOf(a.toLowerCase()) : -1;
  const out = [];
  let pos = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const start = text.indexOf(word, pos);
    pos = start + word.length;
    out.push({ word, hot: at >= 0 && start >= at && pos <= at + a.length });
  }
  return out;
}

/** Words wrapped in at most `max` lines of `width` at px; null when they don't fit. */
function wrapWords(words, px, width, max, weight, family) {
  const lines = [];
  let line = [];
  for (const w of words) {
    const next = [...line, w];
    if (measure(next.map((x) => x.word).join(' '), px, weight, family) <= width) line = next;
    else if (!line.length) return null;
    else { lines.push(line); line = [w]; }
  }
  if (line.length) lines.push(line);
  return lines.length <= max ? lines : null;
}

/** A name in a box: its size from px down to 80%, then 2 lines (at a word break), then smaller; never cut. */
function fitName(name, px, width, maxH, weight = 800) {
  const words = String(name).split(/\s+/).map((word) => ({ word }));
  for (let s = px; s >= px * 0.8; s -= 1) {
    if (measure(name, s, weight) <= width) return { px: s, lines: [name] };
  }
  for (let s = px * 0.8; s >= 10; s -= 1) {
    const lines = words.length > 1 && 2 * s * 1.05 <= maxH ? wrapWords(words, s, width, 2, weight, FONT) : null;
    if (lines) return { px: s, lines: lines.map((l) => l.map((x) => x.word).join(' ')) };
    if (measure(name, s, weight) <= width) return { px: s, lines: [name] };
  }
  return { px: 10, lines: [name] };
}

/** The last emoji of a text (the topic's doodle), or null. */
const lastEmoji = (text) => (String(text).match(/\p{Extended_Pictographic}/gu) ?? []).pop() ?? null;

function TableScreen({ headline, detail, rows, source, highlight = [], clip, valueFormat = null, cardBg = null, accent = null }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bg = cardColor(cardBg);
  const spr = (delay, config = { damping: 12, stiffness: 260, mass: 0.6 }) => spring({ frame: frame - delay, fps, config });
  const hot = new Set(highlight.map((h) => h.trim().toLowerCase()));

  // Values exactly as before: as the source gives them (81, 79.2), "ratio" (4.0, 45), "one_decimal" (52.0), prices $9.04,
  // percentages all with one decimal as soon as one has it. A short unit (%, L) on every value; a long one ("servings") is
  // in the footer's line only.
  const pctDecimals = rows.some((r) => r.unit === '%' && !Number.isInteger(Number(r.value)));
  const fmt = (v, unit) => Number(v).toFixed(valueFormat === 'ratio' ? (Number(v) < 10 ? 1 : 0) : valueFormat === 'one_decimal' ? 1
    : unit === '%' ? (pctDecimals ? 1 : 0) : (Number.isInteger(Number(v)) ? 0 : 1));
  const label = (r) => r.unit === '$' ? `$${Number(r.value).toFixed(2)}`
    : `${fmt(r.value, r.unit)}${r.unit === '%' ? '%' : r.unit.length <= 3 ? ` ${r.unit}` : ''}`;

  const podium = rows.slice(0, 3);
  const list = rows.slice(3);
  const gaps = list.filter((r) => r.gap_before).length;
  // Many rows (up to 20 + 1): the clip and the podium get smaller so every row keeps a readable height.
  const t = clamp01((list.length - 7) / 10);
  const photoH = Math.round(560 - 150 * t);
  const s = 1 - 0.3 * t;

  // The headline: Baloo 2, as big as fits in 2 lines (3 at the smallest size), its accent words in terracotta.
  const words = accentWords(headline, accent);
  let titlePx = TITLE_MIN;
  let titleLines = null;  // reassigned below (balanced)
  for (let px = TITLE_MAX; px >= TITLE_MIN && !titleLines; px -= 2) {
    titleLines = wrapWords(words, px, T_RIGHT - C_LEFT, 2, 800, Q_FONT);
    titlePx = px;
  }
  titleLines ??= wrapWords(words, TITLE_MIN, T_RIGHT - C_LEFT, 3, 800, Q_FONT) ?? [words];
  // Two lines: balanced (no word left alone on the second).
  if (titleLines.length === 2) {
    const all = titleLines.flat();
    const w = (ws) => measure(ws.map((x) => x.word).join(' '), titlePx, 800, Q_FONT);
    let best = titleLines;
    for (let cut = 1; cut < all.length; cut++) {
      const a = all.slice(0, cut), b = all.slice(cut);
      if (w(a) <= T_RIGHT - C_LEFT && w(b) <= T_RIGHT - C_LEFT && Math.max(w(a), w(b)) < Math.max(w(best[0]), w(best[1]))) best = [a, b];
    }
    titleLines = best;
  }
  const titleLH = Math.round(titlePx * 1.08);
  const titleTop = photoH + 4;
  const titleEnd = titleTop + titleLines.length * titleLH;

  // The detail's sticker: one line from 44 down to 30 px, else two lines at 30.
  const stickerW = 900;
  let stickerPx = 30;
  for (let px = 44; px >= 30; px -= 1) { stickerPx = px; if (measure(detail ?? '', px, 800, Q_FONT) <= stickerW - 52) break; }
  const stickerLines = detail ? (measure(detail, stickerPx, 800, Q_FONT) <= stickerW - 52 ? [detail]
    : (wrapWords(detail.split(/\s+/).map((word) => ({ word })), 30, stickerW - 52, 2, 800, Q_FONT) ?? [[{ word: detail }]]).map((l) => l.map((x) => x.word).join(' '))) : [];

  // The podium: #2 left, #1 middle (tallest), #3 right.
  const d = { 1: 150 * s, 2: 118 * s, 3: 118 * s };
  const h = { 0: 236 * s, 1: 196 * s, 2: 172 * s };
  const blockW = (C_RIGHT - C_LEFT - 2 * 22) / 3;
  const podTop = titleEnd + 22 + 44 * s;                       // the crown's room
  const podBase = podTop + d[1] * 0.82 + h[0];
  const slots = [1, 0, 2];                                     // left to right: row index
  // The rows: from under the podium to the footer, each up to 76 px high.
  const listTop = podBase + 26;
  const slot = list.length ? (FOOT_TOP - 26 - listTop) / (list.length + 0.6 * gaps) : 0;
  const rowH = Math.min(76, Math.round(slot * 0.86));
  const stride = Math.min(slot, rowH + 12);
  const k = rowH / 70;
  const tops = [];
  list.reduce((y, r) => { const top = y + (r.gap_before ? stride * 0.6 : 0); tops.push(top); return top + stride; }, listTop);
  const rowW = C_RIGHT - C_LEFT;
  const namePx = 30 * k;
  const rankW = 44 * k, flagX = 14 + rankW + 12, flagS = rowH * 0.6, nameX = flagX + flagS + 14;
  const valW = Math.max(0, ...list.map((r) => measure(label(r), 30 * k))) + 6;
  const nameW = Math.min(rowW * 0.44, Math.max(rowW * 0.26, ...list.map((r) => measure(r.country, namePx))));
  const barX = nameX + nameW + 18;
  const barMax = Math.max(40, rowW - 20 - valW - 16 - barX);
  // One runaway value (more than 2.5× the next): its bar is broken ("//"), the others scaled to the second.
  const vals = list.map((r) => Number(r.value)).sort((a, b) => b - a);
  const broken = vals.length > 2 && vals[0] > 2.5 * vals[1];
  const max = Math.max(1e-9, broken ? vals[1] * 1.15 : vals[0] ?? 1);
  const rowIn = (i) => clamp01((frame - 16 - (list.length > 1 ? (12 * i) / (list.length - 1) : 0)) / 5);

  const sourcePx = fitSize(source, 21, 17, 600, C_RIGHT - C_LEFT);
  // The question on one line, next to the button.
  const askW = C_RIGHT - C_LEFT - 20 - measure('hilads.live 👉', 34, 800, Q_FONT) - 52;
  let askPx = 26;
  for (let px = 40; px >= 26; px -= 1) { askPx = px; if (measure(ASK, px, 800, Q_FONT) <= askW) break; }
  const doodle = lastEmoji(headline);
  const pop = spr(0, { damping: 12, stiffness: 320, mass: 0.5 });
  const sticker = spr(4, { damping: 8, stiffness: 240, mass: 0.6 });

  return (
    <AbsoluteFill style={{ background: bg, fontFamily: FONT, color: INK, overflow: 'hidden' }}>
      {/* Doodles, behind everything. */}
      {[[doodle, 960, titleEnd + 30, 64, 14], ['〰', 8, listTop - 70, 70, -8], ['✦', 990, listTop + 180, 44, 0], [doodle, 1000, FOOT_TOP - 150, 54, -16], ['〰', 900, podTop - 10, 56, 10]]
        .filter(([e]) => e).map(([e, x, y, px, rot], i) => (
          <div key={`d${i}`} style={{ position: 'absolute', left: x, top: y, fontSize: px, opacity: 0.16, color: TERRA, fontWeight: 800,
                                      transform: `rotate(${rot}deg)` }}>{e}</div>
        ))}

      {/* The clip, a wavy edge into the card. */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: photoH, overflow: 'hidden', background: '#7a3b1a' }}>
        {clip && <ClipLoop clip={clip} style={{ width: 1080, height: photoH, objectFit: 'cover' }} />}
      </div>
      <svg width={1080} height={96} viewBox="0 0 400 34" preserveAspectRatio="none" style={{ position: 'absolute', left: 0, top: photoH - 94 }}>
        <path d="M0 22 C70 34 120 4 200 10 C270 15 320 30 400 14 L400 35 L0 35Z" fill={bg} />
      </svg>
      {clip?.credit && (
        <div style={{ position: 'absolute', right: 24, top: 24, fontSize: 18, fontWeight: 600, color: 'rgba(255,255,255,0.85)',
                      background: 'rgba(0,0,0,0.4)', borderRadius: 14, padding: '4px 12px' }}>{clip.credit}</div>
      )}
      {stickerLines.length > 0 && (
        <div style={{ position: 'absolute', left: 44, top: photoH - 96 - stickerLines.length * stickerPx * 1.12 - 28, maxWidth: stickerW,
                      background: STICKER, color: INK, borderRadius: 26, padding: '12px 26px 8px', boxShadow: '0 8px 0 #C9940F',
                      fontFamily: `"${Q_FONT}", "${FONT}"`, fontWeight: 800, fontSize: stickerPx, lineHeight: 1.12, transformOrigin: '10% 100%',
                      transform: `rotate(-4deg) scale(${0.6 + 0.4 * sticker})`, opacity: clamp01(sticker * 2) }}>
          {stickerLines.map((l, i) => <div key={i} style={{ whiteSpace: 'nowrap' }}>{l}</div>)}
        </div>
      )}

      {/* The headline. */}
      <div style={{ position: 'absolute', left: C_LEFT, top: titleTop, width: T_RIGHT - C_LEFT, transformOrigin: 'left center',
                    transform: `scale(${0.92 + 0.08 * pop})`, opacity: 0.92 + 0.08 * pop }}>
        {titleLines.map((l, i) => (
          <div key={i} style={{ fontFamily: `"${Q_FONT}", "${FONT}"`, fontWeight: 800, fontSize: titlePx, lineHeight: `${titleLH}px`,
                                whiteSpace: 'nowrap', letterSpacing: -0.5, paddingTop: titlePx * 0.08 }}>
            {l.map((w, j) => <span key={j} style={{ color: w.hot ? TERRA : INK }}>{j ? ' ' : ''}{w.word}</span>)}
          </div>
        ))}
      </div>

      {/* The podium: the blocks rise #3, #2, then #1; each flag lands on its block. */}
      {slots.map((ri, col) => {
        const r = podium[ri];
        if (!r) return null;
        const color = flagColor(r.emoji);
        const light = luminance(color.startsWith('#') ? color : '#888888') > 0.62;
        const p = spr([12, 8, 4][ri]);
        const bh = h[ri];
        const dd = d[ri + 1];
        const x = C_LEFT + col * (blockW + 22);
        const blockTop = podBase - bh;
        const nm = fitName(r.country, 32 * s, blockW - 24, 72 * s);
        const isFirst = r.rank === 1;
        return (
          <div key={`p${ri}`}>
            <div style={{ position: 'absolute', left: x, top: blockTop, width: blockW, height: bh, borderRadius: `${26 * s}px ${26 * s}px 12px 12px`,
                          background: `linear-gradient(180deg, ${mix(color, '#ffffff', 0.16)}, ${mix(color, '#000000', 0.14)})`,
                          boxShadow: `0 ${8 * s}px 0 ${mix(color, '#000000', 0.35)}`, transformOrigin: 'bottom center', transform: `scaleY(${p})`,
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 14 * s,
                          boxSizing: 'border-box', color: light ? INK : '#fff' }}>
              <div style={{ fontSize: 52 * s, lineHeight: 1.1 }}>{MEDALS[r.rank] ?? ''}</div>
              {nm.lines.map((l, j) => <div key={j} style={{ fontSize: nm.px, fontWeight: 800, lineHeight: 1.08, whiteSpace: 'nowrap' }}>{l}</div>)}
              <div style={{ fontFamily: `"${Q_FONT}", "${FONT}"`, fontWeight: 800, fontSize: 54 * s, lineHeight: 1.05, paddingTop: 6 * s }}>{label(r)}</div>
              {isFirst && (
                <div style={{ marginTop: 4 * s, background: STICKER, color: INK, fontSize: 20 * s, fontWeight: 800, letterSpacing: 1.5,
                              borderRadius: 10, padding: `${3 * s}px ${12 * s}px`, transform: 'rotate(-3deg)' }}>CHAMPION</div>
              )}
            </div>
            <div style={{ position: 'absolute', left: x + (blockW - dd) / 2, top: blockTop - dd * 0.82, width: dd, height: dd, borderRadius: '50%',
                          background: '#fff', border: `${8 * s}px solid ${color}`, boxSizing: 'border-box', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', boxShadow: '0 6px 14px rgba(80,40,10,0.18)',
                          transform: `translateY(${(1 - spr([12, 8, 4][ri] + 4)) * -40}px) scale(${0.4 + 0.6 * spr([12, 8, 4][ri] + 4)})` }}>
              {r.flag && <Img src={staticFile(r.flag)} style={{ width: dd * 0.62, height: dd * 0.62 }} />}
              {isFirst && <div style={{ position: 'absolute', top: -dd * 0.38, left: dd * 0.5 - 30 * s, fontSize: 60 * s, transform: 'rotate(-10deg)' }}>👑</div>}
            </div>
          </div>
        );
      })}

      {/* #4 and after. */}
      {list.map((r, i) => {
        const p = rowIn(i);
        const isHot = r.highlight === true || hot.has(String(r.country).trim().toLowerCase());
        const isBroken = broken && Number(r.value) > max;
        const bar = (isBroken ? barMax : Math.max(10, (barMax * r.value) / max)) * p;
        const nm = fitName(r.country, namePx, nameW, rowH - 8);
        return (
          <div key={`r${i}`} style={{ position: 'absolute', left: C_LEFT, top: tops[i], width: rowW, height: rowH, borderRadius: 18 * k,
                                      background: isHot ? '#FFF0E4' : '#fff', boxSizing: 'border-box', border: isHot ? `3px solid ${TERRA}` : 'none',
                                      boxShadow: `0 ${4 * k}px 0 rgba(150,90,40,0.13)`, opacity: p, transform: `translateY(${(1 - p) * 12}px)` }}>
            <div style={{ position: 'absolute', left: 14, top: 0, width: rankW, height: rowH, display: 'flex', alignItems: 'center',
                          justifyContent: 'flex-end', fontSize: 28 * k, fontWeight: 800, color: isHot ? TERRA : MUTED }}>{r.rank}</div>
            {r.flag && <Img src={staticFile(r.flag)} style={{ position: 'absolute', left: flagX, top: (rowH - flagS) / 2, width: flagS, height: flagS }} />}
            <div style={{ position: 'absolute', left: nameX, top: 0, width: nameW, height: rowH, display: 'flex', flexDirection: 'column',
                          justifyContent: 'center', fontSize: nm.px, fontWeight: 800, lineHeight: 1.05 }}>
              {nm.lines.map((l, j) => <div key={j} style={{ whiteSpace: 'nowrap' }}>{l}</div>)}
            </div>
            <div style={{ position: 'absolute', left: barX, top: (rowH - 16 * k) / 2, height: 16 * k, width: bar, borderRadius: 8 * k,
                          background: flagColor(r.emoji) }} />
            {isBroken && (
              <div style={{ position: 'absolute', left: barX + bar * 0.62, top: (rowH - 30 * k) / 2, height: 30 * k, width: 16 * k, display: 'flex',
                            alignItems: 'center', justifyContent: 'center', background: isHot ? '#FFF0E4' : '#fff', fontSize: 24 * k,
                            fontWeight: 800, fontStyle: 'italic', color: MUTED }}>//</div>
            )}
            <div style={{ position: 'absolute', left: barX + bar + 12, top: 0, height: rowH, display: 'flex', alignItems: 'center',
                          fontSize: 30 * k, fontWeight: 800, color: isHot ? TERRA : INK, whiteSpace: 'nowrap' }}>{label(r)}</div>
          </div>
        );
      })}
      {list.map((r, i) => r.gap_before ? (
        <div key={`g${i}`} style={{ position: 'absolute', left: C_LEFT, top: tops[i] - stride * 0.6, width: rowW, height: stride * 0.6,
                                    opacity: rowIn(i), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 * k,
                                    fontWeight: 800, color: MUTED, letterSpacing: 14 * k }}>• • •</div>
      ) : null)}

      {/* The footer: the question and hilads.live, the unit and the source under them. */}
      <div style={{ position: 'absolute', left: C_LEFT, top: FOOT_TOP, width: C_RIGHT - C_LEFT, display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', gap: 20 }}>
        <div style={{ fontFamily: `"${Q_FONT}", "${FONT}"`, fontWeight: 800, fontSize: askPx, lineHeight: 1.08, paddingTop: 6, whiteSpace: 'nowrap' }}>{ASK}</div>
        <div style={{ flex: 'none', background: TERRA, color: '#fff', fontFamily: `"${Q_FONT}", "${FONT}"`, fontWeight: 800, fontSize: 34,
                      borderRadius: 24, padding: '14px 26px 8px', boxShadow: '0 7px 0 #8A330F', whiteSpace: 'nowrap' }}>hilads.live 👉</div>
      </div>
      <div style={{ position: 'absolute', left: C_LEFT, top: FOOT_TOP + 96, width: C_RIGHT - C_LEFT, fontSize: sourcePx, lineHeight: 1.25,
                    fontWeight: 600, color: MUTED }}>{source}</div>
    </AbsoluteFill>
  );
}
