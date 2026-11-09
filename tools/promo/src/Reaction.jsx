// "Different Worlds by Hilads", reaction + ranking format (Admin › Worlds, DwReaction):
// a silent 1080×1920 video. 0 to 7 s, the table screen (below); 7 to 10 s, the closing slide:
// the clip keeps playing behind, blurred and darkened, the #1's flag, the question in a big
// tilted speech bubble (Baloo 2) that pops in with a bounce, the series mark and hilads.live;
// a fast zoom between the two. Without a question: the table screen alone, 8 s.
// The table screen: top third, the reaction clip (Pixabay, R2 copy),
// cropped, muted, looping, with its small credit. Under it: the headline (readable from
// the first frame, it pops 92% → 100% as the slides format's hook), its detail, then the
// ranking (up to 20 rows + one extra highlighted row), the rows appearing top to bottom
// within 0.5 s then still; #1 and the highlighted countries (Vietnam) in the accent
// color. The source line, then the series mark and hilads.live at the bottom.
// worlds.mjs renders the video and two PNGs (carousels): 01 the table screen, 02 the closing slide.

import { AbsoluteFill, Img, Loop, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from '@remotion/fonts';

const BG = '#16110D';
const ACCENT = '#FF7A3D';
const GOLD = '#D9AE52';
const FONT = 'Be Vietnam Pro';
const LEFT = 72;
const RIGHT = 1080 - 72;
const CLIP_H = 640;
const ROW_H = 44;                         // a row's height with 20 rows; fewer rows grow (rowSize)
const ROWS_TOP = 812;
const ROWS_END = 1736;                    // the source line and the mark come after
// The closing slide's question: a speech bubble (accent, white text, a tail down-left, tilted) in a rounder,
// playful font (Baloo 2, Be Vietnam Pro as the fallback), as big as fits in up to 3 lines.
const Q_FONT = 'Baloo 2';
const Q_MAX_PX = 132;
const Q_MIN_PX = 64;
const Q_TEXT_W = 820;                     // the bubble's text width at most (safe margins, the apps' side buttons)
const Q_PAD_X = 46;
const Q_PAD_Y = 26;
const Q_TILT = -2;
const MARK_TOP = 1792;
const ZOOM = 6;                           // frames: the fast zoom from the table to the closing slide
const ROW_SCALE_MAX = 1.4;
const GAP = 0.7;                          // a "…" separator, in rows
const BAR_X = 520;                        // where the bars start
const BAR_MAX = RIGHT - BAR_X - 130;      // the longest bar leaves room for its value
const STAGGER = 15;                       // frames: the rows appear within 0.5 s
const ROW_IN = 4;                         // frames each row takes to appear
const HEADLINE_MAX = 60;
const HEADLINE_MIN = 40;

for (const [file, weight] of [['SemiBold', '600'], ['Bold', '700'], ['ExtraBold', '800']]) {
  loadFont({ family: FONT, url: staticFile(`fonts/BeVietnamPro-${file}.ttf`), weight });
}
loadFont({ family: Q_FONT, url: staticFile('fonts/Baloo2-Variable.ttf'), weight: '400 800' });

import { TABLE_SECONDS, reactionSeconds } from './reactionTiming.js';
export { reactionSeconds };

let ctx = null;
function measure(text, px, weight = 800, family = FONT) {
  ctx ??= document.createElement('canvas').getContext('2d');
  ctx.font = `${weight} ${px}px "${family}", "${FONT}"`;
  return ctx.measureText(text).width;
}

/** The biggest size from max down to min where the text fits on one line. */
function fitSize(text, max, min, weight = 800) {
  for (let px = max; px > min; px -= 1) {
    if (measure(text, px, weight) <= RIGHT - LEFT) return px;
  }
  return min;
}
const headlineSize = (text) => fitSize(text, HEADLINE_MAX, HEADLINE_MIN);

/**
 * props: {headline, detail, rows: [{rank, country, flag (file in public/flags or null), value, unit, gap_before?, highlight?}],
 * source, highlight: [country], clip: {src, seconds, credit} | null}. gap_before: a "…" separator above the row (the
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

/** The table screen (0 to 7 s with a question, the whole video without). */
function TableScreen({ headline, detail, rows, source, highlight = [], clip, valueFormat = null }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 320, mass: 0.5 } });
  // One runaway value (more than 2.5× the next): its bar is broken (drawn full with a "//" mark), the others
  // are scaled to the second, so they stay readable.
  const sortedVals = rows.map((r) => Number(r.value)).sort((a, b) => b - a);
  const broken = sortedVals.length > 2 && sortedVals[0] > 2.5 * sortedVals[1];
  const max = Math.max(1e-9, broken ? sortedVals[1] * 1.15 : sortedVals[0] ?? 1);
  const hot = new Set(highlight.map((h) => h.trim().toLowerCase()));
  const px = headlineSize(headline);
  // Each value as the source gives it: 81, 79.2 (a whole number shows no decimal); a price in dollars: $9.04.
  // valueFormat "ratio": one decimal below 10, whole numbers from 10 (4.0, 8.9, 45); "one_decimal": always one (52.0).
  // Default: percentages all with one decimal as soon as one has it (52.0% next to 51.8%); other units as given (81, 79.2).
  const pctDecimals = rows.some((r) => r.unit === '%' && !Number.isInteger(Number(r.value)));
  const fmt = (v, unit) => Number(v).toFixed(valueFormat === 'ratio' ? (Number(v) < 10 ? 1 : 0) : valueFormat === 'one_decimal' ? 1
    : unit === '%' ? (pctDecimals ? 1 : 0) : (Number.isInteger(Number(v)) ? 0 : 1));
  // A short unit (%, L) on every row; a long one ("servings") on the first row only, the source line says it.
  const label = (r, i) => r.unit === '$' ? `$${Number(r.value).toFixed(2)}`
    : `${fmt(r.value, r.unit)}${r.unit === '%' ? '' : ' '}${r.unit.length <= 3 || i === 0 ? r.unit : ''}`.trim();
  // Fewer rows are taller, with everything in them larger (up to 1.4×), to fill the space.
  // Row i appears (0 → 1) at its turn: top to bottom within 0.5 s.
  const rowIn = (i) => {
    const at = rows.length > 1 ? ((STAGGER - ROW_IN) * i) / (rows.length - 1) : 0;
    return interpolate(frame, [at, at + ROW_IN], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  };
  // The source line: one line (20 down to 16 px), else two lines at 16 px, the rows giving it room.
  const srcPx = fitSize(source, 20, 16, 600);
  const srcTwoLines = measure(source, 16, 600) > RIGHT - LEFT;
  const rowsLimit = ROWS_END - (srcTwoLines ? 24 : 0);
  const gaps = rows.filter((r) => r.gap_before).length;
  const rowH = Math.max(ROW_H, Math.min(Math.round(ROW_H * ROW_SCALE_MAX), Math.floor((rowsLimit - ROWS_TOP) / Math.max(1, rows.length + GAP * gaps))));
  // Each row's top: a "…" separator (GAP of a row) above a row that follows a skip in the ranking.
  const tops = [];
  rows.reduce((y, r) => { const top = y + (r.gap_before ? rowH * GAP : 0); tops.push(top); return top + rowH; }, ROWS_TOP);
  const rowsEnd = rows.length ? tops[tops.length - 1] + rowH : ROWS_TOP;
  const k = rowH / ROW_H;
  const rankW = 50 * k, flagX = 14 + rankW + 16, flagS = 30 * k, nameX = flagX + flagS + 14;
  // The bars start after the longest name, and the longest bar leaves room for the widest value ("79.2 servings").
  const barX = Math.max(BAR_X - LEFT + 16, nameX + Math.max(...rows.map((r) => measure(String(r.country), 29 * k, 700))) + 24);
  const barMax = Math.min(BAR_MAX, RIGHT - LEFT + 32 - 18 - barX - 14 - Math.max(...rows.map((r, i) => measure(label(r, i), 27 * k))));

  return (
    <AbsoluteFill style={{ background: BG, fontFamily: FONT }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: CLIP_H, overflow: 'hidden', background: '#000' }}>
        {clip && <ClipLoop clip={clip} style={{ width: 1080, height: CLIP_H, objectFit: 'cover' }} />}
      </div>
      <div style={{ position: 'absolute', left: 0, top: CLIP_H - 60, width: 1080, height: 60, background: `linear-gradient(to bottom, rgba(22,17,13,0), ${BG})` }} />
      {clip?.credit && (
        <div style={{ position: 'absolute', right: 24, top: 24, fontSize: 18, fontWeight: 600, color: 'rgba(255,255,255,0.8)',
                      background: 'rgba(0,0,0,0.45)', borderRadius: 14, padding: '4px 12px' }}>{clip.credit}</div>
      )}

      <div style={{ position: 'absolute', left: LEFT, top: CLIP_H + 8, width: RIGHT - LEFT, transformOrigin: 'left center',
                    opacity: 0.92 + 0.08 * pop, transform: `scale(${0.92 + 0.08 * pop})` }}>
        <div style={{ fontSize: px, fontWeight: 800, color: '#fff', lineHeight: '74px', whiteSpace: 'nowrap' }}>{headline}</div>
        {detail ? <div style={{ fontSize: 34, fontWeight: 600, color: 'rgba(255,255,255,0.78)', marginTop: 6 }}>{detail}</div> : null}
      </div>

      {rows.map((r, i) => {
        const p = rowIn(i);
        const isHot = r.rank === 1 || r.highlight === true || hot.has(String(r.country).trim().toLowerCase());
        const isBroken = broken && Number(r.value) > max;
        const bar = isBroken ? barMax : Math.max(8, (barMax * r.value) / max);
        return (
          <div key={`${r.rank}-${r.country}`} style={{ position: 'absolute', left: LEFT - 16, top: tops[i], width: RIGHT - LEFT + 32, height: rowH,
                                     borderRadius: 10, boxSizing: 'border-box', opacity: p, transform: `translateY(${(1 - p) * 10}px)`,
                                     background: isHot ? 'rgba(255,122,61,0.18)' : i % 2 ? 'rgba(255,255,255,0.045)' : 'transparent',
                                     border: `2px solid ${isHot ? ACCENT : 'transparent'}` }}>
            <div style={{ position: 'absolute', left: 14, top: 0, width: rankW, height: rowH - 4, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                          fontSize: 28 * k, fontWeight: 800, color: isHot ? ACCENT : 'rgba(255,255,255,0.6)' }}>{r.rank}</div>
            {r.flag && <Img src={staticFile(r.flag)} style={{ position: 'absolute', left: flagX, top: (rowH - 4 - flagS) / 2, width: flagS, height: flagS }} />}
            <div style={{ position: 'absolute', left: nameX, top: 0, height: rowH - 4, display: 'flex', alignItems: 'center',
                          fontSize: 29 * k, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>{r.country}</div>
            <div style={{ position: 'absolute', left: barX, top: (rowH - 4 - 16 * k) / 2, height: 16 * k, borderRadius: 8 * k, width: bar,
                          background: isHot ? ACCENT : GOLD, opacity: isHot ? 1 : 0.85 }} />
            {isBroken && (
              <div style={{ position: 'absolute', left: barX + bar * 0.62, top: (rowH - 4 - 30 * k) / 2, height: 30 * k, width: 16 * k,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', background: isHot ? 'rgba(61,30,16,1)' : BG,
                            color: '#fff', fontSize: 24 * k, fontWeight: 800, fontStyle: 'italic' }}>//</div>
            )}
            <div style={{ position: 'absolute', left: barX + bar + 14, top: 0, height: rowH - 4, display: 'flex', alignItems: 'center',
                          fontSize: 27 * k, fontWeight: 800, color: isHot ? ACCENT : '#fff', whiteSpace: 'nowrap' }}>
              {label(r, i)}
            </div>
          </div>
        );
      })}

      {rows.map((r, i) => r.gap_before ? (
        // It appears with the row under it.
        <div key={`gap-${i}`} style={{ position: 'absolute', left: LEFT - 16, top: tops[i] - rowH * GAP, width: RIGHT - LEFT + 32, height: rowH * GAP,
                                       opacity: rowIn(i),
                                       display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 * k, fontWeight: 800,
                                       color: 'rgba(255,255,255,0.5)', letterSpacing: 14 * k }}>• • •</div>
      ) : null)}

      <div style={{ position: 'absolute', left: LEFT, top: rowsEnd + (srcTwoLines ? 8 : 14), width: RIGHT - LEFT, fontSize: srcPx, lineHeight: 1.25,
                    fontWeight: 600, whiteSpace: srcTwoLines ? 'normal' : 'nowrap', color: 'rgba(255,255,255,0.55)' }}>{source}</div>


      <div style={{ position: 'absolute', left: LEFT, top: MARK_TOP, display: 'flex', alignItems: 'center', gap: 16 }}>
        <Img src={staticFile('logo.svg')} style={{ width: 48, height: 48 }} />
        <div style={{ fontSize: 22, lineHeight: '28px' }}>
          <div><span style={{ fontWeight: 800, letterSpacing: 2, color: ACCENT }}>DIFFERENT WORLDS</span> <span style={{ fontWeight: 600, color: '#fff' }}>by Hilads</span></div>
          <div style={{ fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Compare your city on <span style={{ fontWeight: 800, color: ACCENT }}>hilads.live</span></div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
