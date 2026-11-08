// "Different Worlds by Hilads", reaction + ranking format (Admin › Worlds, DwReaction):
// one silent 1080×1920 screen for 8 s. Top third: the reaction clip (Pixabay, R2 copy),
// cropped, muted, looping, with its small credit. Under it: the headline (readable from
// the first frame, it pops 92% → 100% as the slides format's hook), its detail, then the
// ranking (up to 20 rows + one extra highlighted row), the rows appearing top to bottom
// within 0.5 s then still; #1 and the highlighted countries (Vietnam) in the accent
// color. The source line, then the series mark and hilads.live at the bottom.
// worlds.mjs renders the video and the last frame as a PNG.

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

export const REACTION_SECONDS = 8;
// A clip of at least 90% of the screen's length plays once (slowed a little when short); a shorter one loops.
export const clipFills = (seconds) => seconds >= REACTION_SECONDS * 0.9;

let ctx = null;
function measure(text, px, weight = 800) {
  ctx ??= document.createElement('canvas').getContext('2d');
  ctx.font = `${weight} ${px}px "${FONT}"`;
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
export function ReactionRanking({ headline, detail, rows, source, highlight = [], clip, valueFormat = null }) {
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
  // valueFormat "ratio": one decimal below 10, whole numbers from 10 (4.0, 8.9, 45).
  const fmt = (v) => Number(v).toFixed(valueFormat === 'ratio' ? (Number(v) < 10 ? 1 : 0) : (Number.isInteger(Number(v)) ? 0 : 1));
  // A short unit (%, L) on every row; a long one ("servings") on the first row only, the source line says it.
  const label = (r, i) => r.unit === '$' ? `$${Number(r.value).toFixed(2)}`
    : `${fmt(r.value)}${r.unit === '%' ? '' : ' '}${r.unit.length <= 3 || i === 0 ? r.unit : ''}`.trim();
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
        {clip && (clipFills(clip.seconds)
          // Played once over the whole screen (a clip a little short is slowed to fill it).
          ? <OffthreadVideo src={staticFile(clip.src)} muted playbackRate={Math.min(1, clip.seconds / REACTION_SECONDS)}
                            style={{ width: 1080, height: CLIP_H, objectFit: 'cover' }} />
          : <Loop durationInFrames={Math.max(1, Math.floor(clip.seconds * fps))}>
              <OffthreadVideo src={staticFile(clip.src)} muted style={{ width: 1080, height: CLIP_H, objectFit: 'cover' }} />
            </Loop>
        )}
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

      <div style={{ position: 'absolute', left: LEFT, top: 1792, display: 'flex', alignItems: 'center', gap: 16 }}>
        <Img src={staticFile('logo.svg')} style={{ width: 48, height: 48 }} />
        <div style={{ fontSize: 22, lineHeight: '28px' }}>
          <div><span style={{ fontWeight: 800, letterSpacing: 2, color: ACCENT }}>DIFFERENT WORLDS</span> <span style={{ fontWeight: 600, color: '#fff' }}>by Hilads</span></div>
          <div style={{ fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>Compare your city on <span style={{ fontWeight: 800, color: ACCENT }}>hilads.live</span></div>
        </div>
      </div>
    </AbsoluteFill>
  );
}
