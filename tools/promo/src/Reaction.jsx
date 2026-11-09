// "Different Worlds by Hilads", reaction + ranking format (Admin › Worlds, DwReaction): a silent 1080×1920
// video of 12.5 s. 0–9.5 s, the light ranking card revealed in sequence (TableScreen, below): 0–3 s the clip and
// the headline (its pop) alone, the hook; 3 s the detail's sticker; 4 s the podium #3, #2, #1, then the crown and
// CHAMPION; 5–6 s the rows cascade top to bottom, then the source line and the series mark; then still, to read or
// pause. No call to action. 9.5–12.5 s, the closing slide (EndCard): the topic's own question and its invitation to Hilads
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

import { END_SECONDS, reactionSeconds } from './reactionTiming.js';
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
  const end = S(END_SECONDS);
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

/** The clip, playing at its speed from the video's start, looping when it ends (the same timing on both scenes). */
function ClipLoop({ clip, style }) {
  const { fps } = useVideoConfig();
  return (
    <Loop durationInFrames={Math.max(1, Math.floor(clip.seconds * fps))}>
      <OffthreadVideo src={staticFile(clip.src)} muted style={style} />
    </Loop>
  );
}

// ── The table screen: a light, playful ranking card, revealed step by step ─────────────────────────────
// Top half: the clip (the hook) with a wavy edge into the card's color and the detail as a tilted yellow sticker low
// in it. Bottom half: the headline (its accent words in terracotta), a compact podium for the top 3 (#1 in the middle,
// the flags' colors), the rows #4 to #10 (a bar in the country's flag color), the source line. The CTA pops in over
// the clip's lower part at the end. Nothing that matters in the apps' bottom 320 px or right 140 px.
// Timeline (30 fps): 0–3 s the clip and the headline alone (it pops); 3 s the sticker; 4 s the podium #3, 4.3 s #2,
// 4.6 s #1 (blocks rise, values count up), 4.9 s the crown and CHAMPION (confetti); 5–6 s the rows cascade
// (slide in, the bar fills); 6 s the source line and the mark fade in; still until the closing slide (9.5 s).

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
  for (let px = 56; px >= 40 && !titleLines; px -= 2) { titleLines = wrapWords(words, px, W, 1, 800, Q_FONT); titlePx = px; }
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
  const titleTop = MEDIA_H - 24;                               // just under the wave
  const titleEnd = titleTop + titleLines.length * titleLH;

  // From the bottom up: the series mark just above the apps' caption, the source line (24 px, up to 3 lines) above it,
  // then the rows fill what is left under the podium; the podium gets smaller (down to 70%) to keep the rows ≥ 40 px apart.
  const markTop = SAFE_BOTTOM - MARK_H;
  const srcPx = 24;
  const srcLines = Math.min(3, Math.ceil((measure(sourceLine, srcPx, 600) * 1.06) / W));
  const srcTop = markTop - 10 - srcLines * 30;
  const twoLineTitle = titleLines.length > 1;
  const slots = Math.max(list.length, 1);
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
  for (let ps = 0.95; ps >= 0.7 && pod.stride < 40; ps -= 0.05) pod = podiumAt(ps);
  const { d, h, podTop, podBase } = pod;
  const blockW = (W - 2 * 16) / 3;
  const listTop = podBase + 12;
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
  const stickerIn = spr(S(3), { damping: 9, stiffness: 220, mass: 0.6 });
  const titleIn = spr(0, { damping: 10, stiffness: 200, mass: 0.6 });
  const podAt = { 2: S(4), 1: S(4.3), 0: S(4.6) };              // #3, #2, #1 (row index → start)
  const crownAt = S(4.9);
  const crown = spr(crownAt, { damping: 9, stiffness: 260, mass: 0.6 });
  const rowAt = (i) => S(5) + (list.length > 1 ? Math.round((S(0.75) * i) / (list.length - 1)) : 0);     // the last starts at 5.75 s
  const srcIn = clamp01((frame - S(6)) / 9);

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
          <div key={`d${i}`} style={{ position: 'absolute', left: x, top: y, fontSize: px, opacity: 0.15 * clamp01((frame - S(6)) / 9),
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

      {/* The headline: on screen from the first frame, with a pop. */}
      <div style={{ position: 'absolute', left: C_LEFT, top: titleTop, width: W, opacity: clamp01(0.4 + titleIn), transformOrigin: 'left center',
                    transform: `scale(${0.85 + 0.15 * titleIn})` }}>
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

      {/* The series mark (no call to action on this screen). */}
      <div style={{ position: 'absolute', left: C_LEFT, top: markTop, height: MARK_H, display: 'flex', alignItems: 'center', gap: 12, opacity: srcIn }}>
        <Img src={staticFile('logo.svg')} style={{ width: 38, height: 38 }} />
        <div style={{ fontSize: 22 }}><span style={{ fontWeight: 800, letterSpacing: 2, color: TERRA }}>DIFFERENT WORLDS</span> <span style={{ fontWeight: 600 }}>by Hilads</span></div>
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
