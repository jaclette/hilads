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
const ROW_H = 44;
const ROWS_TOP = 812;
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
function measure(text, px) {
  ctx ??= document.createElement('canvas').getContext('2d');
  ctx.font = `800 ${px}px "${FONT}"`;
  return ctx.measureText(text).width;
}

/** The headline's size: the biggest that fits on one line. */
function headlineSize(text) {
  for (let px = HEADLINE_MAX; px > HEADLINE_MIN; px -= 2) {
    if (measure(text, px) <= RIGHT - LEFT) return px;
  }
  return HEADLINE_MIN;
}

/** props: {headline, detail, rows: [{rank, country, flag (file in public/flags or null), value, unit}], source, highlight: [country], clip: {src, seconds, credit} | null}. */
export function ReactionRanking({ headline, detail, rows, source, highlight = [], clip }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 320, mass: 0.5 } });
  const max = Math.max(1, ...rows.map((r) => r.value));
  const hot = new Set(highlight.map((h) => h.trim().toLowerCase()));
  const px = headlineSize(headline);

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
        const at = rows.length > 1 ? ((STAGGER - ROW_IN) * i) / (rows.length - 1) : 0;
        const p = interpolate(frame, [at, at + ROW_IN], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        const isHot = r.rank === 1 || hot.has(String(r.country).trim().toLowerCase());
        const bar = Math.max(8, (BAR_MAX * r.value) / max);
        return (
          <div key={`${r.rank}-${r.country}`} style={{ position: 'absolute', left: LEFT - 16, top: ROWS_TOP + i * ROW_H, width: RIGHT - LEFT + 32, height: ROW_H,
                                     borderRadius: 10, boxSizing: 'border-box', opacity: p, transform: `translateY(${(1 - p) * 10}px)`,
                                     background: isHot ? 'rgba(255,122,61,0.18)' : i % 2 ? 'rgba(255,255,255,0.045)' : 'transparent',
                                     border: `2px solid ${isHot ? ACCENT : 'transparent'}` }}>
            <div style={{ position: 'absolute', left: 14, top: 0, width: 50, height: ROW_H - 4, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                          fontSize: 28, fontWeight: 800, color: isHot ? ACCENT : 'rgba(255,255,255,0.6)' }}>{r.rank}</div>
            {r.flag && <Img src={staticFile(r.flag)} style={{ position: 'absolute', left: 80, top: 5, width: 30, height: 30 }} />}
            <div style={{ position: 'absolute', left: 124, top: 0, height: ROW_H - 4, display: 'flex', alignItems: 'center',
                          fontSize: 29, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>{r.country}</div>
            <div style={{ position: 'absolute', left: BAR_X - LEFT + 16, top: 12, height: 16, borderRadius: 8, width: bar,
                          background: isHot ? ACCENT : GOLD, opacity: isHot ? 1 : 0.85 }} />
            <div style={{ position: 'absolute', left: BAR_X - LEFT + 16 + bar + 14, top: 0, height: ROW_H - 4, display: 'flex', alignItems: 'center',
                          fontSize: 27, fontWeight: 800, color: isHot ? ACCENT : '#fff', whiteSpace: 'nowrap' }}>
              {Number(r.value).toFixed(1)} {r.unit}
            </div>
          </div>
        );
      })}

      <div style={{ position: 'absolute', left: LEFT, top: ROWS_TOP + rows.length * ROW_H + 14, width: RIGHT - LEFT, fontSize: 20, fontWeight: 600,
                    color: 'rgba(255,255,255,0.55)' }}>{source}</div>

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
