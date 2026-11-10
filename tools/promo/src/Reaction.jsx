// "Different Worlds by Hilads", reaction + ranking format (Admin › Worlds, DwReaction): a silent 1080×1920
// video of 11 s. 0–8 s, the light ranking card revealed in sequence (TableScreen, below): 0–1.5 s the hook, the
// clip and the headline very big under it; at 1.5 s the headline shrinks up into the header and the detail's sticker
// pops in; 2.1 s the podium #3, #2, #1, then the crown and CHAMPION; 3.1–4.1 s the rows cascade top to bottom, then
// the source line and the series mark; then still, to read or pause. No call to action. 8–11 s, the closing slide (EndCard): the topic's own question and its invitation to Hilads
// (cta_line, a button with hilads.live).
// worlds.mjs renders the video and two PNGs (carousels): 01 the ranking's last frame, 02 the closing slide.

import { AbsoluteFill, Img, Loop, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from '@remotion/fonts';
import { flagColor } from './flagColors.js';

const FONT = 'Be Vietnam Pro';
const LEFT = 72;
const RIGHT = 1080 - 72;
const Q_FONT = 'Baloo 2';                 // rounder, playful: titles, sticker, CTA, end card

for (const [file, weight] of [['SemiBold', '600'], ['Bold', '700'], ['ExtraBold', '800']]) {
  loadFont({ family: FONT, url: staticFile(`fonts/BeVietnamPro-${file}.ttf`), weight });
}
loadFont({ family: Q_FONT, url: staticFile('fonts/Baloo2-Variable.ttf'), weight: '400 800' });

import { RACE, endSeconds, raceEndSeconds, raceOpts, raceSteps, reactionSeconds } from './reactionTiming.js';
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
export function ReactionRanking({ topic = null, question = null, cta = null, ...props }) {
  const frame = useCurrentFrame();
  const end = S(endSeconds(props.mode));
  const card = { headline: props.headline, question, cta, cardBg: props.cardBg };
  // The ranking eases out (a little smaller), the end card pops in over it.
  const out = clamp01((frame - end) / 8);
  return (
    <AbsoluteFill style={{ background: cardColor(props.cardBg) }}>
      {frame < end + 8 && <AbsoluteFill style={{ opacity: 1 - out, transform: `scale(${1 - 0.06 * out})` }}><TableScreen {...props} /></AbsoluteFill>}
      {frame >= end && <AbsoluteFill style={{ opacity: clamp01((frame - end + 1) / 7) }}><EndCard {...card} from={end} /></AbsoluteFill>}
    </AbsoluteFill>
  );
}

/** The clip, playing at its speed (× clip.speed, e.g. 1.5 for slow-motion footage) from the video's start, looping when it ends. */
function ClipLoop({ clip, style }) {
  const { fps } = useVideoConfig();
  const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
  return (
    <Loop durationInFrames={Math.max(1, Math.floor((clip.seconds / speed) * fps))}>
      <OffthreadVideo src={staticFile(clip.src)} muted playbackRate={speed} style={style} />
    </Loop>
  );
}

// ── The table screen: a light, playful ranking card, revealed step by step ─────────────────────────────
// Top half: the clip (the hook) with a wavy edge into the card's color and the detail as a tilted yellow sticker low
// in it. Bottom half: the headline (its accent words in terracotta), a compact podium for the top 3 (#1 in the middle,
// the flags' colors), the rows #4 to #10 (a bar in the country's flag color), the source line. The CTA pops in over
// the clip's lower part at the end. Nothing that matters in the apps' bottom 320 px or right 140 px.
// Timeline (30 fps): 0–1.5 s the clip and the headline very big under it (it pops); 1.5–1.9 s it shrinks into the
// header, the sticker pops; 2.1 s the podium #3, 2.4 s #2, 2.7 s #1 (blocks rise, values count up), 3.0 s the crown
// and CHAMPION (confetti); 3.1–4.1 s the rows cascade (slide in, the bar fills); 4.1 s the source line and the mark
// fade in; still until the closing slide (8 s).

const INK = '#2B1A12';
const MUTED = '#8A6E5C';
const TERRA = '#C24E1C';
const STICKER = '#FFC93C';
const CARD_THEMES = { cream: '#FFF6E9', yellow: '#FFEDB8', green: '#E2F0DA', pink: '#FFE4DC', blue: '#E1EDFF' };
const C_LEFT = 48;
const C_RIGHT = 940;                      // the apps' buttons: the right 140 px
const MEDIA_H = 960;                      // the clip: the top half
const SAFE_BOTTOM = 1600;                 // the apps' caption: the bottom 320 px
const MARK_H = 44;                        // the series mark under the source line
const MAX_ROWS = 10;                      // the podium + #4 to #10
const S = (sec) => Math.round(sec * 30);  // seconds → frames
const MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };

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

function TableScreen({ headline, detail, rows: allRows, source, highlight = [], clip, valueFormat = null, cardBg = null, accent = null,
                       mode = 'classic', quiz = null, guessStill = false, extraRow = null }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bg = cardColor(cardBg);
  const spr = (delay, config = { damping: 12, stiffness: 200, mass: 0.7 }) => spring({ frame: frame - delay, fps, config });
  const hot = new Set(highlight.map((h) => h.trim().toLowerCase()));

  // At most 10 countries (the first 10 rows, as ranked by the source); more: "Top 10" in the source line.
  // extraRow: one country further down (e.g. Vietnam #49), shown after the top 10 under a "• • •" separator, highlighted.
  const extraName = String(extraRow ?? '').trim().toLowerCase();
  const extra = extraName ? allRows.slice(MAX_ROWS).find((r) => String(r.country).trim().toLowerCase() === extraName) : null;
  const rows = [...allRows.slice(0, MAX_ROWS), ...(extra ? [{ ...extra, gap_before: true, highlight: true }] : [])];
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
  // The header: the strongest text of the screen, 1 line from 76 down to 64 px, else 2 lines from 72 (maxTwo) down to 56.
  const headerAt = (maxTwo) => {
    let px = 56;
    let lines = null;
    for (let p = 76; p >= 64 && !lines; p -= 2) { lines = wrapWords(words, p, W, 1, 800, Q_FONT); px = p; }
    for (let p = maxTwo; p >= 56 && !lines; p -= 2) { lines = wrapWords(words, p, W, 2, 800, Q_FONT); px = p; }
    lines ??= [words];
    if (lines.length === 2) {                   // balanced: no word alone on the second line
      const all = lines.flat();
      const w = (ws) => measure(ws.map((x) => x.word).join(' '), px, 800, Q_FONT);
      let best = lines;
      for (let cutAt = 1; cutAt < all.length; cutAt++) {
        const l1 = all.slice(0, cutAt), l2 = all.slice(cutAt);
        if (w(l1) <= W && w(l2) <= W && Math.max(w(l1), w(l2)) < Math.max(w(best[0]), w(best[1]))) best = [l1, l2];
      }
      lines = best;
    }
    return { px, lines };
  };
  let { px: titlePx, lines: titleLines } = headerAt(72);
  const titleTop = MEDIA_H - 28;                               // just under the wave
  let titleLH = Math.round(titlePx * 1.04);
  let titleEnd = titleTop + titleLines.length * titleLH;
  // The hook (0–1.5 s): the same headline as big as fits in the empty area under the clip (up to 2.5× the header, 2 or 3
  // lines), centered; at 1.5 s it shrinks and moves up into the header (0.4 s, eased), crossfading with it.
  const hookArea = { top: MEDIA_H + 20, h: SAFE_BOTTOM - MEDIA_H - 40 };
  let hookPx = titlePx;
  let hookLines = titleLines;
  for (let px = Math.round(titlePx * 2.5); px > titlePx; px -= 4) {
    const lines = wrapWords(words, px, W, 3, 800, Q_FONT);
    if (lines && lines.length * px * 1.04 <= hookArea.h) { hookPx = px; hookLines = lines; break; }
  }
  const hookLH = Math.round(hookPx * 1.04);
  const hookTop = hookArea.top + (hookArea.h - hookLines.length * hookLH) / 2;

  // From the bottom up: the source line (24 px, up to 3 lines) just above the apps' caption, then the rows fill what is
  // left under the podium; the podium gets smaller (down to 60%) to keep the rows ≥ 40 px apart. The series mark is on
  // the clip (top left), the big header needs the room.
  const markTop = SAFE_BOTTOM + 10;
  const srcPx = 24;
  const srcLines = Math.min(3, Math.ceil((measure(sourceLine, srcPx, 600) * 1.06) / W));
  const srcTop = SAFE_BOTTOM - srcLines * 30;
  const twoLineTitle = titleLines.length > 1;
  const gapAt = list.findIndex((r) => r.gap_before);          // the extra row's index (−1: none)
  const GAP = 0.45;                                              // the "• • •" separator, in rows
  const slots = Math.max(list.length + (gapAt >= 0 ? GAP : 0), 1);
  const podiumAt = (ps) => {
    const d = (twoLineTitle ? [66, 56, 56] : [74, 62, 62]).map((x) => Math.round(x * ps));   // flag badges, 30% over their block
    const namePx = Math.max(22, Math.round(26 * ps)), valPx = Math.max(34, Math.round(44 * ps));
    const inner = namePx * 1.1 + valPx + 18;                                                // a block's name and value
    const h = [0, 1, 2].map((i) => Math.round(d[i] * 0.3 + inner + [26, 12, 0][i] * ps));
    const podTop = titleEnd + 4 + 24 * ps;                                                  // the crown's room
    const podBase = podTop + d[0] * 0.7 + h[0];
    return { d, h, namePx, valPx, podTop, podBase, stride: Math.min(64, (srcTop - 10 - podBase - 12) / slots) };
  };
  let pod = podiumAt(1);
  for (let ps = 0.95; ps >= 0.6 && pod.stride < 40; ps -= 0.05) pod = podiumAt(ps);
  // Still tight (many rows, an extra row): a two-line header a little smaller (down to 56 px), then the podium again.
  for (let maxTwo = 68; maxTwo >= 56 && pod.stride < 38 && titleLines.length > 1; maxTwo -= 4) {
    ({ px: titlePx, lines: titleLines } = headerAt(maxTwo));
    titleLH = Math.round(titlePx * 1.04);
    titleEnd = titleTop + titleLines.length * titleLH;
    pod = podiumAt(1);
    for (let ps = 0.95; ps >= 0.5 && pod.stride < 38; ps -= 0.05) pod = podiumAt(ps);
  }
  const { d, h, podTop, podBase } = pod;
  const blockW = (W - 2 * 16) / 3;
  const listTop = podBase + 12;
  const rowTop = (i) => listTop + i * stride + (gapAt >= 0 && i >= gapAt ? GAP * stride : 0);
  const stride = pod.stride;
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
  // Quiz mode: the quiz question alone 1 s, then a 3, 2, 1 countdown (1 s each) until the reveal (4 s), then the
  // classic sequence 2.4 s later.
  const isQuiz = mode === 'quiz' && String(quiz ?? '').trim() !== '';
  const reveal = isQuiz ? S(4) : S(1.5);
  const shift = isQuiz ? S(2.4) : 0;
  const stickerIn = spr(reveal, { damping: 9, stiffness: 220, mass: 0.6 });
  const titleIn = spr(0, { damping: 10, stiffness: 200, mass: 0.6 });
  const podAt = { 2: S(2.1) + shift, 1: S(2.4) + shift, 0: S(2.7) + shift };   // #3, #2, #1 (row index → start)
  const crownAt = S(3.0) + shift;
  const crown = spr(crownAt, { damping: 9, stiffness: 260, mass: 0.6 });
  const rowAt = (i) => S(3.1) + shift + (list.length > 1 ? Math.round((S(0.75) * i) / (list.length - 1)) : 0);   // the last starts at 3.85 s
  const srcIn = clamp01((frame - S(4.1) - shift) / 9);
  // Classic: the hook → the header, 1.5 to 1.9 s. Quiz: the header appears in place at the reveal.
  const move = isQuiz ? (frame >= reveal ? 1 : 0) : ease((frame - S(1.5)) / 12);

  const stickerLines = detail ? [detail] : [];
  let stickerPx = 30;
  for (let px = 40; px >= 28; px -= 1) { stickerPx = px; if (measure(detail ?? '', px, 800, Q_FONT) <= 820) break; }
  // The sticker at the very bottom of the clip, on the wave's edge: under the subject's face and the food.
  const stickerTop = MEDIA_H - 52 - stickerPx * 1.15 - 18;
  const doodle = lastEmoji(headline);
  const BALOO = `"${Q_FONT}", "${FONT}"`;

  return (
    <AbsoluteFill style={{ background: bg, fontFamily: FONT, color: INK, overflow: 'hidden' }}>
      {/* Doodles, faint, behind the ranking. */}
      {[[doodle, 958, podTop + 10, 56, 14], ['〰', 8, listTop - 40, 60, -8], ['✦', 975, listTop + 160, 40, 0]]
        .filter(([e]) => e).map(([e, x, y, px, rot], i) => (
          <div key={`d${i}`} style={{ position: 'absolute', left: x, top: y, fontSize: px, opacity: 0.15 * clamp01((frame - S(4.1) - shift) / 9),
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

      {/* The hook: the headline very big and centered from the first frame (a pop), then shrinking up into the header. */}
      {!isQuiz && move < 1 && (
        <div style={{ position: 'absolute', left: C_LEFT, top: hookTop + (titleTop - hookTop) * move, width: W, textAlign: 'center',
                      transformOrigin: 'center top', opacity: clamp01(0.4 + titleIn) * (1 - clamp01((move - 0.4) / 0.2)),
                      transform: `scale(${(0.85 + 0.15 * titleIn) * (1 + (titlePx / hookPx - 1) * move)})` }}>
          {hookLines.map((l, i) => (
            <div key={i} style={{ fontFamily: BALOO, fontWeight: 800, fontSize: hookPx, lineHeight: `${hookLH}px`, whiteSpace: 'nowrap',
                                  letterSpacing: -1, paddingTop: hookPx * 0.08 }}>
              {l.map((w, j) => <span key={j} style={{ color: w.hot ? TERRA : INK }}>{j ? ' ' : ''}{w.word}</span>)}
            </div>
          ))}
        </div>
      )}
      {isQuiz && frame < reveal + 6 && <QuizHook quiz={quiz} frame={frame} fps={fps} reveal={reveal} guessStill={guessStill} />}
      {/* The header: it takes over once the big headline has faded (never both at once). */}
      <div style={{ position: 'absolute', left: C_LEFT, top: titleTop, width: W, transformOrigin: 'left top',
                    opacity: isQuiz ? clamp01((frame - reveal) / 5) : clamp01((move - 0.6) / 0.25),
                    transform: `scale(${isQuiz ? 1.06 - 0.06 * clamp01((frame - reveal) / 6) : 1.08 - 0.08 * move})` }}>
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
        const nm = fitName(r.country, pod.namePx, blockW - 20, pod.namePx * 1.2);
        const isFirst = r.rank === 1;
        return (
          <div key={`p${ri}`} style={{ opacity: frame >= at ? 1 : 0 }}>
            <div style={{ position: 'absolute', left: x, top: blockTop, width: blockW, height: bh, borderRadius: '22px 22px 10px 10px',
                          background: `linear-gradient(180deg, ${mix(color, '#ffffff', 0.16)}, ${mix(color, '#000000', 0.14)})`,
                          boxShadow: `0 6px 0 ${mix(color, '#000000', 0.35)}`, transformOrigin: 'bottom center', transform: `scaleY(${Math.max(0, rise)})`,
                          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 10,
                          boxSizing: 'border-box', color: light ? INK : '#fff' }}>
              {nm.lines.map((l, j) => <div key={j} style={{ fontSize: nm.px, fontWeight: 800, lineHeight: 1.1, whiteSpace: 'nowrap' }}>{l}</div>)}
              <div style={{ fontFamily: BALOO, fontWeight: 800, fontSize: pod.valPx, lineHeight: 1, paddingTop: 6 }}>{label(r, count)}</div>
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
          <div key={`r${i}`} style={{ position: 'absolute', left: C_LEFT, top: rowTop(i), width: W, height: rowH, borderRadius: 16,
                                      background: isHot ? '#FFF0E4' : '#fff', boxSizing: 'border-box',
                                      boxShadow: `${isHot ? `inset 0 0 0 3px ${TERRA}, ` : ''}0 3px 0 rgba(150,90,40,0.13)`, opacity: p, transform: `translateX(${(1 - p) * -80}px)` }}>
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

      {gapAt >= 0 && (
        <div style={{ position: 'absolute', left: C_LEFT, top: rowTop(gapAt) - GAP * stride, width: W, height: GAP * stride, display: 'flex',
                      alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 800, color: MUTED, letterSpacing: 14,
                      opacity: ease((frame - rowAt(gapAt)) / 9) }}>• • •</div>
      )}
      <div style={{ position: 'absolute', left: C_LEFT, top: srcTop, width: W, fontSize: srcPx, lineHeight: '30px', fontWeight: 600,
                    color: '#6E5444', opacity: srcIn }}>{sourceLine}</div>

      {/* The series mark, on the clip's top left under the apps' top bar (no call to action on this screen). */}
      <div style={{ position: 'absolute', left: 32, top: 150, height: MARK_H, display: 'flex', alignItems: 'center', gap: 10, opacity: srcIn,
                    background: 'rgba(255,246,233,0.92)', borderRadius: 22, padding: '0 16px 0 6px' }}>
        <Img src={staticFile('logo.svg')} style={{ width: 34, height: 34 }} />
        <div style={{ fontSize: 21 }}><span style={{ fontWeight: 800, letterSpacing: 2, color: TERRA }}>DIFFERENT WORLDS</span> <span style={{ fontWeight: 600 }}>by Hilads</span></div>
      </div>
    </AbsoluteFill>
  );
}

/**
 * The closing slide (7–10 s; PNG 02): the card's color and doodles, the Hilads logo and series mark, the topic's own
 * question (big, YOU/YOUR in terracotta) and its invitation to Hilads as a button (cta_line, with hilads.live), popping
 * in one after the other. Centered in the area the apps leave free (not the bottom 320 px, not the right 140 px).
 */
function EndCard({ headline, question, cta, cardBg, from, still = false }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bg = cardColor(cardBg);
  const pop = (delay, config = { damping: 9, stiffness: 220, mass: 0.6 }) => (still ? 1 : spring({ frame: frame - from - delay, fps, config }));
  const W = C_RIGHT - C_LEFT;
  const BALOO = `"${Q_FONT}", "${FONT}"`;
  // The question: as big as fits in 2 lines (3 for a long one), YOU / YOUR in terracotta.
  const qWords = String(question ?? '').trim().split(/\s+/).filter(Boolean).map((word) => ({ word, hot: /^YOU(R)?\b/.test(word) }));
  let qPx = 64;
  let qLines = null;
  for (let px = 124; px >= 76 && !qLines; px -= 2) { qLines = wrapWords(qWords, px, W, 2, 800, Q_FONT); qPx = px; }
  for (let px = 96; px >= 64 && !qLines; px -= 2) { qLines = wrapWords(qWords, px, W, 3, 800, Q_FONT); qPx = px; }
  qLines ??= [qWords];
  // The button: one line from 60 down to 40 px, else two lines.
  const ctaText = String(cta ?? '').trim();
  const ctaW = W - 2 * 44;
  let ctaPx = 40;
  for (let px = 60; px >= 40; px -= 1) { ctaPx = px; if (measure(ctaText, px, 800, Q_FONT) <= ctaW) break; }
  const ctaLines = measure(ctaText, ctaPx, 800, Q_FONT) <= ctaW ? [ctaText]
    : (wrapWords(ctaText.split(' ').map((word) => ({ word })), 44, ctaW, 2, 800, Q_FONT) ?? [[{ word: ctaText }]]).map((l) => l.map((x) => x.word).join(' '));
  if (ctaLines.length > 1) ctaPx = 44;
  const doodle = lastEmoji(question) ?? lastEmoji(headline);
  const logo = pop(2), q = pop(6, { damping: 8, stiffness: 180, mass: 0.7 }), btn = pop(16, { damping: 7, stiffness: 200, mass: 0.6 });
  const fade = (p) => clamp01(p * 2);
  const groupH = 120 + 14 + 36 + 60 + qLines.length * qPx * 1.1 + 64 + ctaLines.length * ctaPx * 1.15 + 40;
  return (
    <AbsoluteFill style={{ background: bg, fontFamily: FONT, color: INK, overflow: 'hidden' }}>
      {[[doodle, 90, 230, 110, -12], ['〰', 780, 300, 90, 10], ['✦', 120, 1250, 70, 0], [doodle, 820, 1300, 96, 16], ['〰', 60, 1450, 80, -8], ['✦', 860, 600, 56, 0]]
        .filter(([e]) => e).map(([e, x, y, px, rot], i) => (
          <div key={i} style={{ position: 'absolute', left: x, top: y, fontSize: px, opacity: 0.18 * (still ? 1 : clamp01((frame - from) / 10)),
                                color: TERRA, fontWeight: 800, transform: `rotate(${rot}deg)` }}>{e}</div>
        ))}
      {/* The group centered between the top bar and the apps' caption. */}
      <div style={{ position: 'absolute', left: C_LEFT, top: Math.max(170, 880 - groupH / 2), width: W, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Img src={staticFile('logo.svg')} style={{ width: 120, height: 120, transform: `scale(${logo})`, opacity: fade(logo) }} />
        <div style={{ marginTop: 14, fontSize: 28, letterSpacing: 3, fontWeight: 800, color: TERRA, opacity: fade(logo) }}>
          DIFFERENT WORLDS <span style={{ letterSpacing: 0, fontWeight: 600, color: INK }}>by Hilads</span>
        </div>
        <div style={{ marginTop: 60, transform: `scale(${0.6 + 0.4 * q}) rotate(-2deg)`, opacity: fade(q), textAlign: 'center' }}>
          {qLines.map((l, i) => (
            <div key={i} style={{ fontFamily: BALOO, fontWeight: 800, fontSize: qPx, lineHeight: 1.02, whiteSpace: 'nowrap', paddingTop: qPx * 0.08 }}>
              {l.map((w, j) => <span key={j} style={{ color: w.hot ? TERRA : INK }}>{j ? ' ' : ''}{w.word}</span>)}
            </div>
          ))}
        </div>
        {ctaText && (
          <div style={{ marginTop: 64, maxWidth: W, background: TERRA, color: '#fff', fontFamily: BALOO, fontWeight: 800, fontSize: ctaPx, lineHeight: 1.15,
                        borderRadius: 36, padding: '20px 44px 10px', boxShadow: '0 10px 0 #8A330F', textAlign: 'center', boxSizing: 'border-box',
                        transform: `scale(${0.5 + 0.5 * btn})`, opacity: fade(btn) }}>
            {ctaLines.map((l, i) => <div key={i} style={{ whiteSpace: 'nowrap' }}>{l}</div>)}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}

/**
 * The quiz hook (quiz mode, 0 to 4 s; PNG 01 with "Guess before you swipe 👉"): under the clip, the quiz question
 * very big in a speech bubble (accent, white text, Baloo 2, tilted, a tail), from the first frame, alone for 1 s
 * (to read it); then a countdown 3, 2, 1 under it (1 s each, a punchy pop on each number); at 4 s the bubble pops away.
 */
function QuizHook({ quiz, frame, fps, reveal, guessStill }) {
  const W = C_RIGHT - C_LEFT;
  const BALOO = `"${Q_FONT}", "${FONT}"`;
  const words = String(quiz).trim().split(/\s+/).map((word) => ({ word }));
  const textW = W - 2 * 44;
  let px = 60;
  let lines = null;
  for (let p = 112; p >= 60 && !lines; p -= 2) { lines = wrapWords(words, p, textW, 3, 800, Q_FONT); px = p; }
  lines ??= [words];
  const lineH = Math.round(px * 1.06);
  const bubbleH = lines.length * lineH + 2 * 28;
  const tail = 44;
  const countH = 200;
  const area = { top: MEDIA_H + 20, h: SAFE_BOTTOM - MEDIA_H - 40 };
  const top = area.top + (area.h - (bubbleH + tail + 24 + countH)) / 2;
  const pop = guessStill ? 1 : spring({ frame, fps, config: { damping: 9, stiffness: 260, mass: 0.5 } });
  const away = guessStill ? 0 : clamp01((frame - reveal) / 5);
  // The countdown: 3 from 1 s, 2 from 2 s, 1 from 3 s.
  const step = Math.floor((frame - S(1)) / S(1));
  const n = 3 - step;
  const numPop = spring({ frame: frame - S(1) - step * S(1), fps, config: { damping: 7, stiffness: 320, mass: 0.45 } });
  return (
    <div style={{ position: 'absolute', left: C_LEFT, top, width: W, display: 'flex', flexDirection: 'column', alignItems: 'center',
                  transform: `scale(${(0.85 + 0.15 * pop) * (1 - 0.6 * away)})`, opacity: 1 - away, transformOrigin: 'center 40%' }}>
      <div style={{ position: 'relative', transform: 'rotate(-2deg)' }}>
        <div style={{ background: TERRA, color: '#fff', borderRadius: 44, padding: '28px 44px', boxShadow: '0 12px 30px rgba(120,50,15,0.28)',
                      textAlign: 'center', maxWidth: W, boxSizing: 'border-box' }}>
          {lines.map((l, i) => (
            <div key={i} style={{ fontFamily: BALOO, fontWeight: 800, fontSize: px, lineHeight: `${lineH}px`, whiteSpace: 'nowrap', paddingTop: px * 0.08 }}>
              {l.map((w) => w.word).join(' ')}
            </div>
          ))}
        </div>
        <svg width={tail * 1.6} height={tail} style={{ position: 'absolute', left: '18%', top: '100%', marginTop: -1 }}>
          <path d={`M0 0 L${tail * 1.6} 0 L${tail * 0.1} ${tail} Z`} fill={TERRA} />
        </svg>
      </div>
      <div style={{ height: countH, marginTop: tail + 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {guessStill ? (
          <div style={{ fontFamily: BALOO, fontWeight: 800, fontSize: 64, color: INK, whiteSpace: 'nowrap' }}>Guess before you swipe 👉</div>
        ) : n >= 1 && n <= 3 && frame >= S(1) ? (
          <div style={{ width: countH, height: countH, borderRadius: '50%', background: STICKER, boxShadow: '0 10px 0 #C9940F', display: 'flex',
                        alignItems: 'center', justifyContent: 'center', fontFamily: BALOO, fontWeight: 800, fontSize: 150, color: INK,
                        paddingTop: 18, boxSizing: 'border-box', transform: `scale(${0.4 + 0.6 * numPop}) rotate(${(1 - numPop) * -20}deg)` }}>{n}</div>
        ) : null}
      </div>
    </div>
  );
}

// ── The race format: a bar chart race over the years ─────────────────────────────────────────────
// No clip: the race is the motion. The headline hook (very big, centered, with its emoji), then the header at the top;
// the top 10 of each year as bars (rank, flag, name, value; the flag's color), the year very big in the chart's corner,
// values and positions interpolated between years (smooth swaps); a pop banner at the striking year (detail); a 2 s
// freeze on the last year with the crown on #1; the source line and the series mark at the bottom; the closing slide.
// props: {headline, accent, years: [2000, …], series: [{country, flag (file), emoji, values: {year: number}}], unit,
// source, detail (the banner), bannerYear, highlight: [country], cardBg, question, cta}.

const RACE_ROWS = 10;
const smooth = (x) => x * x * (3 - 2 * x);

/** Each country's value at a fractional year index t (eased between two years). */
function raceValues(series, years, t) {
  const i = Math.min(years.length - 1, Math.floor(t));
  const j = Math.min(years.length - 1, i + 1);
  const e = smooth(t - i);
  return series.map((c) => {
    const a = Number(c.values[years[i]] ?? 0), b = Number(c.values[years[j]] ?? 0);
    return a + (b - a) * e;
  });
}
/** Each country's rank (0 = first) at t. */
function raceRanks(series, years, t, dec = 1) {
  // At a year itself, with the source's ranks: its order (ties as the source breaks them). Else on the values as shown
  // (rounded to `dec` decimals), ties in the alphabetical order.
  const f = 10 ** dec;
  const v = raceValues(series, years, t).map((x) => Math.round(x * f) / f);
  // Ties: the source's order (series' order, e.g. the first to reach a count stays above), else alphabetical.
  const at = Number.isInteger(t) && series.every((c) => c.ranks?.[years[t]] != null) ? years[t] : null;
  const next = years[Math.min(years.length - 1, Math.ceil(t))];
  const tie = (a, b) => ((series[a].order?.[next] ?? 0) - (series[b].order?.[next] ?? 0)) || String(series[a].country).localeCompare(String(series[b].country));
  const order = v.map((x, k) => [x, k]).sort((p, q) => at != null ? (series[p[1]].ranks[at] - series[q[1]].ranks[at]) || tie(p[1], q[1])
    : (q[0] - p[0]) || tie(p[1], q[1]));
  const r = new Array(series.length);
  order.forEach(([, k], n) => { r[k] = n; });
  return r;
}

export function RaceVideo({ question = null, cta = null, ...props }) {
  const frame = useCurrentFrame();
  const end = S(raceEndSeconds(props.years, props));
  const out = clamp01((frame - end) / 8);
  return (
    <AbsoluteFill style={{ background: cardColor(props.cardBg) }}>
      {frame < end + 8 && <AbsoluteFill style={{ opacity: 1 - out, transform: `scale(${1 - 0.06 * out})` }}><RaceScreen {...props} /></AbsoluteFill>}
      {frame >= end && <AbsoluteFill style={{ opacity: clamp01((frame - end + 1) / 7) }}><EndCard headline={props.headline} question={question} cta={cta} cardBg={props.cardBg} from={end} /></AbsoluteFill>}
    </AbsoluteFill>
  );
}

function RaceScreen({ headline, accent = null, years, series, unit = '', source, detail = null, bannerYear = null, highlight = [], cardBg = null,
                     extraRow = null, decimals = 1, yearLabels = null, stepSeconds, startSeconds, hold, slowFrom, slowStep, valuePrefix = '' }) {
  const { start: START, hold: HOLD } = raceOpts({ stepSeconds, startSeconds, hold });
  // Each step's length (a faster pace for early years, slower from slowFrom) and when each step starts.
  const steps = raceSteps(years, { stepSeconds, slowFrom, slowStep });
  const stepAt = [0];
  steps.forEach((d) => stepAt.push(stepAt[stepAt.length - 1] + d));
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bg = cardColor(cardBg);
  const BALOO = `"${Q_FONT}", "${FONT}"`;
  const W = C_RIGHT - C_LEFT;
  const n = years.length;
  const hot = new Set(highlight.map((h) => String(h).trim().toLowerCase()));
  // extraRow: one country shown under the top 10 (a "• • •" separator), highlighted, with its real rank each year (its
  // series' ranks), e.g. Vietnam; it never races in the top 10.
  const extraIdx = extraRow ? series.findIndex((c) => String(c.country).trim().toLowerCase() === String(extraRow).trim().toLowerCase()) : -1;
  const extra = extraIdx >= 0 ? series[extraIdx] : null;
  if (extra) series = series.filter((_, i) => i !== extraIdx);
  const roundShown = (v) => Math.round(v * 10 ** decimals) / 10 ** decimals;

  // The race clock: year index t (0 … n−1); within each step the move takes its first (1 − HOLD), then it holds.
  const tAt = (f) => {
    const s = f / fps - START;
    if (s <= 0 || n < 2) return 0;
    let i = 0;
    while (i < n - 1 && stepAt[i + 1] <= s) i++;
    return i >= n - 1 ? n - 1 : i + clamp01((s - stepAt[i]) / steps[i] / (1 - HOLD));
  };
  const t = tAt(frame);
  const values = raceValues(series, years, t);
  // The bars' scale: the highest value so far (the collapse of a year shows as bars shrinking, not as a new scale).
  let scaleMax = 1e-9;
  for (let y = 0; y <= Math.floor(t); y++) scaleMax = Math.max(scaleMax, ...series.map((c) => Number(c.values[years[y]] ?? 0)));
  scaleMax = Math.max(scaleMax, ...values);
  // Ranks: the exact rank of the values shown (the label), and the position slides to it as soon as the values cross
  // (each rank change eases over SLIDE frames): the order on screen always follows the values, the rows stay even.
  const SLIDE = 8;
  const rankNow = raceRanks(series, years, t, decimals);
  const hist = [];
  for (let k = SLIDE; k >= 0; k--) hist.push(raceRanks(series, years, tAt(frame - k), decimals));
  const pos = series.map((_, c) => {
    let p = hist[0][c];
    for (let k = 1; k <= SLIDE; k++) {
      const d = hist[k][c] - hist[k - 1][c];
      if (d !== 0) p += d * ease((SLIDE - k + 1) / SLIDE);
    }
    return p;
  });
  const year = years[Math.min(n - 1, Math.round(t))];
  const raceEnd = S(START + stepAt[n - 1]);

  // The header (as the reaction format: the strongest text) and the hook (very big, centered, with its emoji).
  const words = accentWords(headline, accent);
  let titlePx = 56;
  let titleLines = null;
  for (let p = 76; p >= 64 && !titleLines; p -= 2) { titleLines = wrapWords(words, p, W, 1, 800, Q_FONT); titlePx = p; }
  for (let p = 72; p >= 56 && !titleLines; p -= 2) { titleLines = wrapWords(words, p, W, 2, 800, Q_FONT); titlePx = p; }
  titleLines ??= [words];
  const titleLH = Math.round(titlePx * 1.04);
  const titleTop = 150;                                       // under the apps' top bar
  const titleEnd = titleTop + titleLines.length * titleLH;
  const titleIn = spring({ frame, fps, config: { damping: 10, stiffness: 200, mass: 0.6 } });

  // The chart: from under the header to the source line and the mark (above the apps' caption).
  const srcPx = 24;
  const srcLines = Math.min(3, Math.ceil((measure(source, srcPx, 600) * 1.06) / W));
  const markTop = SAFE_BOTTOM - 40;
  const srcTop = markTop - 10 - srcLines * 30;
  // Under the headline: the timeline (first → last year, a moving marker) and the year, big, in the accent color.
  const yearLabel = (y) => String(yearLabels?.[y] ?? y);
  const yearPx = Math.max(...years.map((y) => yearLabel(y).length)) > 4 ? 96 : 120;
  const yearRowTop = titleEnd + 14;
  const yearRowH = 128;
  const yearW = Math.max(...years.map((y) => measure(yearLabel(y), yearPx, 800, Q_FONT))) + 10;
  const lineX0 = C_LEFT + 8, lineX1 = C_RIGHT - yearW * 1.25 - 40;   // room for the year's pop
  const chartTop = yearRowTop + yearRowH + 8;
  const chartBottom = srcTop - 24;
  const rowH = (chartBottom - chartTop) / (RACE_ROWS + (extra ? 1.5 : 0));
  const barH = Math.round(rowH * 0.62);
  const flagS = Math.round(barH * 0.92);
  const rankW = 54, flagX = C_LEFT + rankW + 10, barX = flagX + flagS + 14;
  const namePx = Math.max(26, Math.min(36, Math.round(barH * 0.5)));
  const valPx = namePx;
  const barMax = C_RIGHT - barX - 150;
  const grow = ease(frame / S(0.45));                        // the first year's bars grow in (0 → 0.45 s)
  const label = (v) => `${valuePrefix}${v.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
  // The rank shown: tied values (as shown) share a rank, the next one is +1 (as the Henley index ranks).
  const shown = values.map(roundShown);
  const distinct = [...new Set(shown)].sort((a, b) => b - a);
  const denseRank = (k) => distinct.indexOf(shown[k]) + 1;

  // The banner at the striking year (it pops while the race goes on), the crown on #1 at the freeze.
  const bIdx = bannerYear != null ? years.map(String).indexOf(String(bannerYear)) : -1;
  const bannerAt = bIdx > 0 ? S(START + stepAt[bIdx - 1] + 0.6 * (1 - HOLD) * steps[bIdx - 1]) : bIdx === 0 ? S(START) : null;
  const bannerOn = bannerAt != null && detail ? spring({ frame: frame - bannerAt, fps, config: { damping: 8, stiffness: 220, mass: 0.6 } }) : 0;
  const bannerOff = bannerAt != null ? clamp01((frame - bannerAt - S(1.4)) / 6) : 0;
  const crown = spring({ frame: frame - raceEnd - 3, fps, config: { damping: 9, stiffness: 260, mass: 0.6 } });
  // The banner's text as big as fits (64 down to 36 px) inside the safe width.
  let bannerPx = 36;
  for (let px = 64; px >= 36; px -= 2) { bannerPx = px; if (measure(detail ?? '', px, 800, Q_FONT) + 72 <= 1080 - 140 - 60) break; }
  const first = rankNow.indexOf(0);
  const chartIn = 1;
  // The year pops each time it changes (the moment the race passes half-way between two years).
  const yi = Math.min(n - 1, Math.round(t));
  const since = yi > 0 ? frame - S(START + stepAt[yi - 1] + 0.5 * (1 - HOLD) * steps[yi - 1]) : 99;
  const yearPop = since >= 0 && since < 10 ? 1 + 0.22 * (1 - ease(since / 10)) : 1;
  const progress = n > 1 ? t / (n - 1) : 1;
  // At a year itself, the source's rank (when the series has them); between years the rank of the values shown.
  const atYear = Number.isInteger(t) && series.every((c) => c.ranks?.[years[t]] != null) ? years[t] : null;

  return (
    <AbsoluteFill style={{ background: bg, fontFamily: FONT, color: INK, overflow: 'hidden' }}>
      {/* The headline in its header from the first frame, with a pop. */}
      <div style={{ position: 'absolute', left: C_LEFT, top: titleTop, width: W, opacity: clamp01(0.4 + titleIn), transformOrigin: 'left top',
                    transform: `scale(${0.9 + 0.1 * titleIn})` }}>
        {titleLines.map((l, i) => (
          <div key={i} style={{ fontFamily: BALOO, fontWeight: 800, fontSize: titlePx, lineHeight: `${titleLH}px`, whiteSpace: 'nowrap',
                                letterSpacing: -0.5, paddingTop: titlePx * 0.08 }}>
            {l.map((w, j) => <span key={j} style={{ color: w.hot ? TERRA : INK }}>{j ? ' ' : ''}{w.word}</span>)}
          </div>
        ))}
      </div>

      {/* The timeline and the year. */}
      <div style={{ position: 'absolute', left: lineX0, top: yearRowTop + yearRowH / 2 - 4, width: lineX1 - lineX0, height: 8, borderRadius: 4, background: 'rgba(43,26,18,0.14)' }} />
      <div style={{ position: 'absolute', left: lineX0, top: yearRowTop + yearRowH / 2 - 4, width: (lineX1 - lineX0) * progress, height: 8, borderRadius: 4, background: TERRA }} />
      <div style={{ position: 'absolute', left: lineX0 + (lineX1 - lineX0) * progress - 14, top: yearRowTop + yearRowH / 2 - 14, width: 28, height: 28,
                    borderRadius: 14, background: TERRA, boxShadow: '0 0 0 6px rgba(194,78,28,0.22)' }} />
      <div style={{ position: 'absolute', left: lineX0, top: yearRowTop + yearRowH / 2 + 18, fontSize: 24, fontWeight: 700, color: MUTED }}>{yearLabel(years[0])}</div>
      <div style={{ position: 'absolute', left: lineX1 - 80, width: 80, textAlign: 'right', top: yearRowTop + yearRowH / 2 + 18, fontSize: 24, fontWeight: 700, color: MUTED }}>{yearLabel(years[n - 1])}</div>
      <div style={{ position: 'absolute', right: 1080 - C_RIGHT, top: yearRowTop, height: yearRowH, display: 'flex', alignItems: 'center',
                    fontFamily: BALOO, fontWeight: 800, fontSize: yearPx, color: TERRA, letterSpacing: -2, paddingTop: yearPx * 0.1,
                    transformOrigin: 'right center', transform: `scale(${yearPop})` }}>{yearLabel(year)}</div>

      {/* The bars: the top 10 at each moment, positions smoothed (overtakes slide), entering / leaving at the bottom. */}
      {series.map((c, k) => {
        const p = pos[k];
        const v = values[k];
        // Nothing yet (a count still at 0): not on the board.
        if (p >= RACE_ROWS || roundShown(v) <= 0) return null;
        const y = chartTop + p * rowH;
        const fade = clamp01(RACE_ROWS - p) * chartIn;
        const w = Math.max(6, (barMax * v) / scaleMax) * grow;
        const color = flagColor(c.emoji);
        const isHot = hot.has(String(c.country).trim().toLowerCase());
        const nameW = measure(c.country, namePx, 800);
        const inside = nameW + 36 <= w;
        const rank = atYear != null ? c.ranks[atYear] : denseRank(k);
        return (
          <div key={c.country} style={{ position: 'absolute', left: 0, top: y, width: 1080, height: rowH, opacity: fade }}>
            <div style={{ position: 'absolute', left: C_LEFT, top: 0, width: rankW, height: rowH, display: 'flex', alignItems: 'center',
                          justifyContent: 'flex-end', fontSize: namePx - 2, fontWeight: 800, color: isHot ? TERRA : MUTED }}>{rank}</div>
            {c.flag && <Img src={staticFile(c.flag)} style={{ position: 'absolute', left: flagX, top: (rowH - flagS) / 2, width: flagS, height: flagS }} />}
            {k === first && frame >= raceEnd && (
              <div style={{ position: 'absolute', left: flagX + flagS * 0.15, top: (rowH - flagS) / 2 - 46 - (1 - crown) * 80, fontSize: 48,
                            transform: 'rotate(-12deg)', opacity: clamp01(crown * 2) }}>👑</div>
            )}
            <div style={{ position: 'absolute', left: barX, top: (rowH - barH) / 2, width: w, height: barH, borderRadius: barH * 0.28,
                          background: `linear-gradient(90deg, ${mix(color, '#ffffff', 0.12)}, ${mix(color, '#000000', 0.1)})`,
                          boxShadow: isHot ? `0 0 0 4px ${TERRA}` : '0 3px 0 rgba(80,40,10,0.15)' }} />
            <div style={{ position: 'absolute', left: inside ? barX + 18 : barX + w + 14, top: 0, height: rowH, display: 'flex', alignItems: 'center',
                          gap: 14, whiteSpace: 'nowrap', fontWeight: 800, fontSize: namePx }}>
              <span style={{ color: inside ? (luminance(color) > 0.62 ? INK : '#fff') : INK }}>{c.country}</span>
              {!inside && <span style={{ fontSize: valPx, color: isHot ? TERRA : INK }}>{label(v)}</span>}
            </div>
            {inside && (
              <div style={{ position: 'absolute', left: barX + w + 14, top: 0, height: rowH, display: 'flex', alignItems: 'center',
                            fontSize: valPx, fontWeight: 800, color: isHot ? TERRA : INK, whiteSpace: 'nowrap' }}>{label(v)}</div>
            )}
          </div>
        );
      })}

      {/* The extra row (e.g. Vietnam): under a "• • •" separator, its real rank and value each year, highlighted. */}
      {extra && (() => {
        const v = raceValues([extra], years, t)[0];
        const y = chartTop + (RACE_ROWS + 0.5) * rowH;
        const w = Math.max(6, (barMax * v) / scaleMax) * grow;
        const color = flagColor(extra.emoji);
        const nameW = measure(extra.country, namePx, 800);
        const inside = nameW + 36 <= w;
        const rank = extra.ranks?.[years[Math.min(n - 1, Math.round(t))]] ?? '';
        return (
          <>
            <div style={{ position: 'absolute', left: C_LEFT, top: chartTop + RACE_ROWS * rowH, width: W, height: rowH * 0.5, display: 'flex',
                          alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 800, color: MUTED, letterSpacing: 14 }}>• • •</div>
            <div style={{ position: 'absolute', left: C_LEFT - 12, top: y + 4, width: W + 24, height: rowH - 8, borderRadius: 18, background: '#FFF0E4',
                          boxShadow: `inset 0 0 0 3px ${TERRA}` }} />
            <div style={{ position: 'absolute', left: C_LEFT, top: y, width: rankW, height: rowH, display: 'flex', alignItems: 'center',
                          justifyContent: 'flex-end', fontSize: namePx - 2, fontWeight: 800, color: TERRA }}>{rank}</div>
            {extra.flag && <Img src={staticFile(extra.flag)} style={{ position: 'absolute', left: flagX, top: y + (rowH - flagS) / 2, width: flagS, height: flagS }} />}
            <div style={{ position: 'absolute', left: barX, top: y + (rowH - barH) / 2, width: w, height: barH, borderRadius: barH * 0.28,
                          background: `linear-gradient(90deg, ${mix(color, '#ffffff', 0.12)}, ${mix(color, '#000000', 0.1)})` }} />
            <div style={{ position: 'absolute', left: inside ? barX + 18 : barX + w + 14, top: y, height: rowH, display: 'flex', alignItems: 'center',
                          gap: 14, whiteSpace: 'nowrap', fontWeight: 800, fontSize: namePx }}>
              <span style={{ color: inside ? (luminance(color) > 0.62 ? INK : '#fff') : INK }}>{extra.country}</span>
              {!inside && <span style={{ fontSize: valPx, color: TERRA }}>{label(v)}</span>}
            </div>
            {inside && (
              <div style={{ position: 'absolute', left: barX + w + 14, top: y, height: rowH, display: 'flex', alignItems: 'center',
                            fontSize: valPx, fontWeight: 800, color: TERRA, whiteSpace: 'nowrap' }}>{label(v)}</div>
            )}
          </>
        );
      })()}

      {/* The striking moment: a pop banner over the chart, the race goes on. */}
      {bannerOn > 0 && bannerOff < 1 && (
        <div style={{ position: 'absolute', left: 0, width: 1080 - 140, top: chartTop + rowH * 3.6, display: 'flex', justifyContent: 'center',
                      opacity: clamp01(bannerOn * 2) * (1 - bannerOff) }}>
          <div style={{ background: STICKER, color: INK, borderRadius: 30, padding: '18px 36px 12px', boxShadow: '0 9px 0 #C9940F, 0 18px 40px rgba(60,30,10,0.25)',
                        fontFamily: BALOO, fontWeight: 800, fontSize: bannerPx, whiteSpace: 'nowrap', transform: `rotate(-4deg) scale(${0.5 + 0.5 * bannerOn})` }}>{detail}</div>
        </div>
      )}

      <div style={{ position: 'absolute', left: C_LEFT, top: srcTop, width: W, fontSize: srcPx, lineHeight: '30px', fontWeight: 600, color: '#6E5444',
                    opacity: chartIn }}>{source}</div>
      <div style={{ position: 'absolute', left: C_LEFT, top: markTop, height: 40, display: 'flex', alignItems: 'center', gap: 10, opacity: chartIn }}>
        <Img src={staticFile('logo.svg')} style={{ width: 34, height: 34 }} />
        <div style={{ fontSize: 21 }}><span style={{ fontWeight: 800, letterSpacing: 2, color: TERRA }}>DIFFERENT WORLDS</span> <span style={{ fontWeight: 600 }}>by Hilads</span></div>
      </div>
    </AbsoluteFill>
  );
}
