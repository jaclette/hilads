// "Different Worlds by Hilads", reaction + ranking format (Admin › Worlds, DwReaction): a silent 1080×1920
// video of 10 s, the light ranking card revealed step by step (TableScreen, below): the clip alone with its sticker
// (the hook), the headline, the podium #3 → #2 → #1, the rows one by one, then the CTA, held to the end.
// worlds.mjs renders the video and two PNGs (carousels): 01 its last frame, 02 the question slide (ClosingSlide:
// the clip blurred and darkened, the #1's flag, the question in a big tilted speech bubble, the series mark).

import { AbsoluteFill, Img, Loop, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from '@remotion/fonts';
import { flagColor } from './flagColors.js';

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

import { reactionSeconds } from './reactionTiming.js';
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
export function ReactionRanking({ question = null, closing = false, ...props }) {
  // closing: the question slide alone, at rest (PNG 02).
  const q = (question ?? '').trim();
  if (closing && q) return <ClosingSlide question={q} clip={props.clip} first={props.rows?.[0] ?? null} from={0} still />;
  return <TableScreen {...props} />;
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

// ── The table screen: a light, playful ranking card, revealed step by step ─────────────────────────────
// Top half: the clip (the hook) with a wavy edge into the card's color and the detail as a tilted yellow sticker low
// in it. Bottom half: the headline (its accent words in terracotta), a compact podium for the top 3 (#1 in the middle,
// the flags' colors), the rows #4 to #10 (a bar in the country's flag color), the source line. The CTA pops in over
// the clip's lower part at the end. Nothing that matters in the apps' bottom 320 px or right 140 px.
// Timeline (30 fps): 0–1.5 s the clip, the sticker pops; 1.5–2.5 s the headline slides in; 2.5–4.5 s the podium
// #3, #2, #1 (blocks rise, values count up, the crown drops with confetti); 4.5–8 s the rows one by one (slide in,
// the bar fills); 8 s the CTA; held to 10 s.

const INK = '#2B1A12';
const MUTED = '#8A6E5C';
const TERRA = '#C24E1C';
const STICKER = '#FFC93C';
const CARD_THEMES = { cream: '#FFF6E9', yellow: '#FFEDB8', green: '#E2F0DA', pink: '#FFE4DC', blue: '#E1EDFF' };
const C_LEFT = 48;
const C_RIGHT = 940;                      // the apps' buttons: the right 140 px
const MEDIA_H = 960;                      // the clip: the top half
const SAFE_BOTTOM = 1600;                 // the apps' caption: the bottom 320 px
const MAX_ROWS = 10;                      // the podium + #4 to #10
const S = (sec) => Math.round(sec * 30);  // seconds → frames
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

const ease = (x) => 1 - Math.pow(1 - clamp01(x), 3);
/** A few confetti, deterministic (index-seeded), bursting from (x, y) at frame `at`. */
function Confetti({ x, y, at }) {
  const frame = useCurrentFrame();
  const t = (frame - at) / 30;
  if (t < 0 || t > 1.3) return null;
  const colors = [STICKER, TERRA, '#F2783A', '#3BAA6B', '#3B7BE0', '#E2457A'];
  return Array.from({ length: 26 }, (_, i) => {
    const a = (i / 26) * Math.PI * 2 + (i % 3) * 0.4;
    const v = 260 + ((i * 37) % 7) * 45;
    const px = x + Math.cos(a) * v * t;
    const py = y + Math.sin(a) * v * t * 0.8 + 520 * t * t;
    return (
      <div key={i} style={{ position: 'absolute', left: px, top: py, width: 12, height: i % 2 ? 12 : 20, borderRadius: i % 4 ? 3 : 6,
                            background: colors[i % colors.length], opacity: 1 - clamp01((t - 0.8) / 0.5),
                            transform: `rotate(${(i * 47 + t * 540) % 360}deg)` }} />
    );
  });
}

function TableScreen({ headline, detail, rows: allRows, source, highlight = [], clip, valueFormat = null, cardBg = null, accent = null }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bg = cardColor(cardBg);
  const spr = (delay, config = { damping: 12, stiffness: 200, mass: 0.7 }) => spring({ frame: frame - delay, fps, config });
  const hot = new Set(highlight.map((h) => h.trim().toLowerCase()));

  // At most 10 countries (the first 10 rows, as ranked by the source); more: "Top 10" in the source line.
  const rows = allRows.slice(0, MAX_ROWS);
  const cut = allRows.length > MAX_ROWS;
  const sourceLine = cut ? `Top ${MAX_ROWS} · ${source}` : source;

  // Values as the source gives them (81, 79.2), "ratio" (4.0, 45), "one_decimal" (52.0), prices $9.04, percentages all
  // with one decimal as soon as one has it; a short unit (%, L) on each value, a long one ("servings") in the source line.
  // While counting up, the same decimals; the last frames show the exact value.
  const pctDecimals = rows.some((r) => r.unit === '%' && !Number.isInteger(Number(r.value)));
  const decimals = (r) => r.unit === '$' ? 2 : valueFormat === 'ratio' ? (Number(r.value) < 10 ? 1 : 0) : valueFormat === 'one_decimal' ? 1
    : r.unit === '%' ? (pctDecimals ? 1 : 0) : (Number.isInteger(Number(r.value)) ? 0 : 1);
  const label = (r, p = 1) => {
    const v = (Number(r.value) * clamp01(p)).toFixed(decimals(r));
    return r.unit === '$' ? `$${v}` : `${v}${r.unit === '%' ? '%' : r.unit.length <= 3 ? ` ${r.unit}` : ''}`;
  };

  const podium = rows.slice(0, 3);
  const list = rows.slice(3);

  // ── Layout (bottom half, above the apps' caption) ──
  const words = accentWords(headline, accent);
  const W = C_RIGHT - C_LEFT;
  let titlePx = 56;
  let titleLines = null;
  for (let px = 56; px >= 46 && !titleLines; px -= 2) { titleLines = wrapWords(words, px, W, 1, 800, Q_FONT); titlePx = px; }
  for (let px = 48; px >= 36 && !titleLines; px -= 2) { titleLines = wrapWords(words, px, W, 2, 800, Q_FONT); titlePx = px; }
  titleLines ??= [words];
  if (titleLines.length === 2) {                // balanced: no word alone on the second line
    const all = titleLines.flat();
    const w = (ws) => measure(ws.map((x) => x.word).join(' '), titlePx, 800, Q_FONT);
    let best = titleLines;
    for (let cutAt = 1; cutAt < all.length; cutAt++) {
      const a = all.slice(0, cutAt), b = all.slice(cutAt);
      if (w(a) <= W && w(b) <= W && Math.max(w(a), w(b)) < Math.max(w(best[0]), w(best[1]))) best = [a, b];
    }
    titleLines = best;
  }
  const titleLH = Math.round(titlePx * 1.04);
  const titleTop = MEDIA_H - 6;
  const titleEnd = titleTop + titleLines.length * titleLH;

  // The source line at the bottom (24 px, up to 3 lines), the rows fill what is left between it and the podium.
  const srcPx = 24;
  const srcLines = Math.min(3, Math.ceil((measure(sourceLine, srcPx, 600) * 1.06) / W));
  const srcTop = SAFE_BOTTOM - srcLines * 30;
  const twoLineTitle = titleLines.length > 1;
  const d = twoLineTitle ? [66, 56, 56] : [74, 62, 62];        // flag badges, 30% over their block
  const inner = 92;                                            // a block's name and value
  const h = [0, 1, 2].map((i) => Math.round(d[i] * 0.3 + inner + [twoLineTitle ? 18 : 26, twoLineTitle ? 8 : 12, 0][i]));
  const crownRoom = 24;
  const podTop = titleEnd + 6 + crownRoom;
  const podBase = podTop + d[0] * 0.7 + h[0];
  const blockW = (W - 2 * 16) / 3;
  const listTop = podBase + 12;
  const slots = Math.max(list.length, 1);
  const stride = Math.min(64, (srcTop - 10 - listTop) / slots);
  const rowH = Math.round(stride - 5);
  const textPx = Math.max(28, Math.min(34, Math.round(rowH * 0.62)));
  const flagS = Math.round(rowH * 0.62);
  const rankW = 40, flagX = 12 + rankW + 10, nameX = flagX + flagS + 12;
  const valW = Math.max(0, ...list.map((r) => measure(label(r), textPx))) + 6;
  const nameW = Math.min(W * 0.42, Math.max(W * 0.24, ...list.map((r) => measure(r.country, textPx))));
  const barX = nameX + nameW + 16;
  const barMax = Math.max(40, W - 16 - valW - 14 - barX);
  const vals = list.map((r) => Number(r.value)).sort((a, b) => b - a);
  const broken = vals.length > 2 && vals[0] > 2.5 * vals[1];
  const max = Math.max(1e-9, broken ? vals[1] * 1.15 : vals[0] ?? 1);

  // ── Timeline ──
  const stickerIn = spr(S(0.3), { damping: 9, stiffness: 220, mass: 0.6 });
  const titleIn = spr(S(1.5), { damping: 16, stiffness: 160, mass: 0.8 });
  const podAt = { 2: S(2.5), 1: S(3.05), 0: S(3.6) };           // #3, #2, #1 (row index → start)
  const crownAt = S(4.15);
  const crown = spr(crownAt, { damping: 9, stiffness: 260, mass: 0.6 });
  const rowAt = (i) => S(4.5) + (list.length > 1 ? Math.round((S(3.0) * i) / Math.max(6, list.length - 1)) : 0);
  const ctaIn = spr(S(8), { damping: 10, stiffness: 200, mass: 0.7 });
  const srcIn = clamp01((frame - S(4.5)) / 12);

  const stickerLines = detail ? [detail] : [];
  let stickerPx = 30;
  for (let px = 44; px >= 30; px -= 1) { stickerPx = px; if (measure(detail ?? '', px, 800, Q_FONT) <= 860) break; }
  const stickerTop = MEDIA_H - 100 - stickerPx * 1.15 - 22;
  const doodle = lastEmoji(headline);
  const BALOO = `"${Q_FONT}", "${FONT}"`;
  const askPx = (() => { const room = W - 40 - 14 - measure('hilads.live 👉', 32, 800, Q_FONT) - 44 - 14;
    for (let px = 38; px > 24; px -= 1) if (measure(ASK, px, 800, Q_FONT) <= room) return px; return 24; })();

  return (
    <AbsoluteFill style={{ background: bg, fontFamily: FONT, color: INK, overflow: 'hidden' }}>
      {/* Doodles, faint, behind the ranking. */}
      {[[doodle, 958, podTop + 10, 56, 14], ['〰', 8, listTop - 40, 60, -8], ['✦', 975, listTop + 160, 40, 0]]
        .filter(([e]) => e).map(([e, x, y, px, rot], i) => (
          <div key={`d${i}`} style={{ position: 'absolute', left: x, top: y, fontSize: px, opacity: 0.15 * clamp01((frame - S(1.5)) / 15),
                                      color: TERRA, fontWeight: 800, transform: `rotate(${rot}deg)` }}>{e}</div>
        ))}

      {/* The clip: the top half, a wavy edge into the card. */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: MEDIA_H, overflow: 'hidden', background: '#7a3b1a' }}>
        {clip && <ClipLoop clip={clip} style={{ width: 1080, height: MEDIA_H, objectFit: 'cover' }} />}
      </div>
      <svg width={1080} height={90} viewBox="0 0 400 34" preserveAspectRatio="none" style={{ position: 'absolute', left: 0, top: MEDIA_H - 88 }}>
        <path d="M0 22 C70 34 120 4 200 10 C270 15 320 30 400 14 L400 35 L0 35Z" fill={bg} />
      </svg>
      {clip?.credit && (
        <div style={{ position: 'absolute', right: 24, top: 150, fontSize: 18, fontWeight: 600, color: 'rgba(255,255,255,0.85)',
                      background: 'rgba(0,0,0,0.4)', borderRadius: 14, padding: '4px 12px' }}>{clip.credit}</div>
      )}
      {/* The sticker: low in the clip, left (faces are higher up). */}
      {stickerLines.length > 0 && (
        <div style={{ position: 'absolute', left: 40, top: stickerTop, background: STICKER, color: INK, borderRadius: 24,
                      padding: '11px 24px 7px', boxShadow: '0 7px 0 #C9940F', fontFamily: BALOO, fontWeight: 800, fontSize: stickerPx,
                      lineHeight: 1.15, whiteSpace: 'nowrap', transformOrigin: '10% 100%',
                      transform: `rotate(-4deg) scale(${0.5 + 0.5 * stickerIn})`, opacity: clamp01(stickerIn * 2) }}>{detail}</div>
      )}

      {/* The headline slides in from the left. */}
      <div style={{ position: 'absolute', left: C_LEFT, top: titleTop, width: W, opacity: clamp01(titleIn * 1.5),
                    transform: `translateX(${(1 - titleIn) * -120}px)` }}>
        {titleLines.map((l, i) => (
          <div key={i} style={{ fontFamily: BALOO, fontWeight: 800, fontSize: titlePx, lineHeight: `${titleLH}px`, whiteSpace: 'nowrap',
                                letterSpacing: -0.5, paddingTop: titlePx * 0.08 }}>
            {l.map((w, j) => <span key={j} style={{ color: w.hot ? TERRA : INK }}>{j ? ' ' : ''}{w.word}</span>)}
          </div>
        ))}
      </div>

      {/* The podium: #2 left, #1 middle, #3 right; revealed #3, #2, #1. */}
      {[1, 0, 2].map((ri, col) => {
        const r = podium[ri];
        if (!r) return null;
        const at = podAt[ri];
        const rise = spr(at, { damping: 9, stiffness: 170, mass: 0.7 });
        const count = ease((frame - at - 4) / 22);
        const badge = spr(at + 6, { damping: 9, stiffness: 240, mass: 0.6 });
        const color = flagColor(r.emoji);
        const light = luminance(color) > 0.62;
        const bh = h[ri];
        const dd = d[ri];
        const x = C_LEFT + col * (blockW + 16);
        const blockTop = podBase - bh;
        const nm = fitName(r.country, 26, blockW - 20, 30);
        const isFirst = r.rank === 1;
        return (
          <div key={`p${ri}`} style={{ opacity: frame >= at ? 1 : 0 }}>
            <div style={{ position: 'absolute', left: x, top: blockTop, width: blockW, height: bh, borderRadius: '22px 22px 10px 10px',
                          background: `linear-gradient(180deg, ${mix(color, '#ffffff', 0.16)}, ${mix(color, '#000000', 0.14)})`,
                          boxShadow: `0 6px 0 ${mix(color, '#000000', 0.35)}`, transformOrigin: 'bottom center', transform: `scaleY(${Math.max(0, rise)})`,
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 10,
                          boxSizing: 'border-box', color: light ? INK : '#fff' }}>
              {nm.lines.map((l, j) => <div key={j} style={{ fontSize: nm.px, fontWeight: 800, lineHeight: 1.1, whiteSpace: 'nowrap' }}>{l}</div>)}
              <div style={{ fontFamily: BALOO, fontWeight: 800, fontSize: 44, lineHeight: 1, paddingTop: 6 }}>{label(r, count)}</div>
            </div>
            {isFirst && (
              <div style={{ position: 'absolute', left: x + blockW - 104, top: blockTop - 12, background: STICKER, color: INK, fontSize: 15, fontWeight: 800,
                            letterSpacing: 1.2, borderRadius: 8, padding: '2px 8px', transform: `rotate(6deg) scale(${crown})`, opacity: clamp01(crown * 2) }}>CHAMPION</div>
            )}
            <div style={{ position: 'absolute', left: x + (blockW - dd) / 2, top: blockTop - dd * 0.7, width: dd, height: dd, borderRadius: '50%',
                          background: '#fff', border: `6px solid ${color}`, boxSizing: 'border-box', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', boxShadow: '0 4px 10px rgba(80,40,10,0.18)',
                          transform: `scale(${Math.max(0, badge)})`, opacity: clamp01(badge * 2) }}>
              {r.flag && <Img src={staticFile(r.flag)} style={{ width: dd * 0.62, height: dd * 0.62 }} />}
              <div style={{ position: 'absolute', right: -20, bottom: -8, fontSize: 36 }}>{MEDALS[r.rank] ?? ''}</div>
            </div>
            {isFirst && (
              <div style={{ position: 'absolute', left: x + blockW / 2 - 24, top: blockTop - dd * 0.7 - 32 - (1 - crown) * 160, fontSize: 44,
                            transform: 'rotate(-10deg)', opacity: frame >= crownAt ? 1 : 0 }}>👑</div>
            )}
          </div>
        );
      })}
      {podium[0] && <Confetti x={C_LEFT + blockW + 16 + blockW / 2} y={podBase - h[0] - d[0] * 0.7} at={crownAt + 4} />}

      {/* #4 to #10, one by one: slide in from the left, the bar fills. */}
      {list.map((r, i) => {
        const at = rowAt(i);
        const p = ease((frame - at) / 9);
        const fill = ease((frame - at - 3) / 12);
        const isHot = r.highlight === true || hot.has(String(r.country).trim().toLowerCase());
        const isBroken = broken && Number(r.value) > max;
        const bar = (isBroken ? barMax : Math.max(10, (barMax * r.value) / max)) * fill;
        const nm = fitName(r.country, textPx, nameW, rowH - 4);
        return (
          <div key={`r${i}`} style={{ position: 'absolute', left: C_LEFT, top: listTop + i * stride, width: W, height: rowH, borderRadius: 16,
                                      background: isHot ? '#FFF0E4' : '#fff', boxSizing: 'border-box', border: isHot ? `3px solid ${TERRA}` : 'none',
                                      boxShadow: '0 3px 0 rgba(150,90,40,0.13)', opacity: p, transform: `translateX(${(1 - p) * -80}px)` }}>
            <div style={{ position: 'absolute', left: 12, top: 0, width: rankW, height: rowH, display: 'flex', alignItems: 'center',
                          justifyContent: 'flex-end', fontSize: textPx - 2, fontWeight: 800, color: isHot ? TERRA : MUTED }}>{r.rank}</div>
            {r.flag && <Img src={staticFile(r.flag)} style={{ position: 'absolute', left: flagX, top: (rowH - flagS) / 2, width: flagS, height: flagS }} />}
            <div style={{ position: 'absolute', left: nameX, top: 0, width: nameW, height: rowH, display: 'flex', flexDirection: 'column',
                          justifyContent: 'center', fontSize: nm.px, fontWeight: 800, lineHeight: 1.05 }}>
              {nm.lines.map((l, j) => <div key={j} style={{ whiteSpace: 'nowrap' }}>{l}</div>)}
            </div>
            <div style={{ position: 'absolute', left: barX, top: (rowH - 14) / 2, height: 14, width: bar, borderRadius: 7, background: flagColor(r.emoji) }} />
            {isBroken && fill >= 1 && (
              <div style={{ position: 'absolute', left: barX + bar * 0.62, top: (rowH - 26) / 2, height: 26, width: 14, display: 'flex',
                            alignItems: 'center', justifyContent: 'center', background: isHot ? '#FFF0E4' : '#fff', fontSize: 22, fontWeight: 800,
                            fontStyle: 'italic', color: MUTED }}>//</div>
            )}
            <div style={{ position: 'absolute', left: barX + bar + 12, top: 0, height: rowH, display: 'flex', alignItems: 'center',
                          fontSize: textPx, fontWeight: 800, color: isHot ? TERRA : INK, whiteSpace: 'nowrap' }}>{label(r, fill)}</div>
          </div>
        );
      })}

      <div style={{ position: 'absolute', left: C_LEFT, top: srcTop, width: W, fontSize: srcPx, lineHeight: '30px', fontWeight: 600,
                    color: '#6E5444', opacity: srcIn }}>{sourceLine}</div>

      {/* The CTA at 8 s: one row over the clip's lower part, above the sticker (the face stays visible). */}
      <div style={{ position: 'absolute', left: C_LEFT, top: (stickerLines.length ? stickerTop - 34 : MEDIA_H - 120) - 104, width: W, height: 100,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, background: 'rgba(255,246,233,0.97)',
                    borderRadius: 28, padding: '0 14px 0 26px', boxSizing: 'border-box', boxShadow: '0 10px 26px rgba(40,20,5,0.3)',
                    transformOrigin: 'center bottom', transform: `scale(${Math.max(0, 0.6 + 0.4 * ctaIn)})`, opacity: clamp01(ctaIn * 2) }}>
        <div style={{ fontFamily: BALOO, fontWeight: 800, fontSize: askPx, lineHeight: 1.08, whiteSpace: 'nowrap', paddingTop: 4 }}>{ASK}</div>
        <div style={{ flex: 'none', background: TERRA, color: '#fff', fontFamily: BALOO, fontWeight: 800, fontSize: 32, borderRadius: 22,
                      padding: '10px 22px 4px', boxShadow: '0 6px 0 #8A330F', whiteSpace: 'nowrap' }}>hilads.live 👉</div>
      </div>
    </AbsoluteFill>
  );
}
