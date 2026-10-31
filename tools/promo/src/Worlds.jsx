// "Different Worlds by Hilads" video (Admin › Worlds): the day's package as a
// silent 1080×1920 video, one part per slide, the same layout as the slides the
// API renders (backend/api/src/DwSlides.php): the photo on top with a slow
// zoom, the series pill and the photo credit, then the flag, the country and
// the text rising in. Music is added in each app when publishing.

import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from '@remotion/fonts';

const BG = '#16110D';
const ACCENT = '#FF7A3D';
const GOLD = '#D9AE52';
const FONT = 'Be Vietnam Pro';
const LEFT = 72;
const WIDTH = 1080 - LEFT - 170;   // the right 170 px stay free for the apps' buttons
const BOTTOM = 1560;               // under it: the apps' caption and buttons
const OUTRO_QUESTION_BOTTOM = 1436; // the outro's question ends above its hilads.live line
const CTA_TOP = 1472;
const CTA_LOGO = 64;

for (const [file, weight] of [['SemiBold', '600'], ['Bold', '700'], ['ExtraBold', '800']]) {
  loadFont({ family: FONT, url: staticFile(`fonts/BeVietnamPro-${file}.ttf`), weight });
}

export const FPS = 30;
export const FADE = 8;                                    // frames of crossfade into a slide
const SECONDS = { hook: 3.5, country: 4.5, outro: 4.5 };

/** [{start, length}] in frames for each slide, and the total. Pure. */
export function worldsTiming(slides) {
  let at = 0;
  const parts = slides.map((s) => {
    const length = Math.round((SECONDS[s.kind] ?? 3.5) * FPS);
    const part = { start: at, length };
    at += length;
    return part;
  });
  return { parts, total: at };
}

// ── Text fitting (the same rules as DwSlides::block) ─────────────────────────

let ctx = null;
function measure(text, px, weight = 800) {
  ctx ??= document.createElement('canvas').getContext('2d');
  ctx.font = `${weight} ${px}px "${FONT}"`;
  return ctx.measureText(text).width;
}

function wrap(text, px, width, weight) {
  const lines = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, px, weight) > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The biggest size from max down to min where the text fits above bottom: {px, lines}. */
function fit(text, top, max, min, bottom = BOTTOM) {
  let lines = [];
  let px = max;
  for (; px >= min; px -= 4) {
    lines = wrap(text, px, WIDTH, 800);
    const height = px * 0.95 + (lines.length - 1) * px * 1.16;
    if (top + height <= bottom && Math.max(...lines.map((l) => measure(l, px))) <= WIDTH) break;
  }
  return { px: Math.max(px, min), lines };
}

/** No emoji on screen (the slides drop them too). */
const plain = (s) => (s ?? '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{E0020}-\u{E007F}]/gu, '').replace(/\s+/g, ' ').trim();

// ── One slide ────────────────────────────────────────────────────────────────

function useIn(delay) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 150 } });
}

function Rise({ delay, children, style }) {
  const p = useIn(delay);
  return <div style={{ position: 'absolute', opacity: p, transform: `translateY(${(1 - p) * 36}px)`, ...style }}>{children}</div>;
}

function Lines({ text, top, max, min, delay, bottom }) {
  const { px, lines } = fit(plain(text), top, max, min, bottom);
  return (
    <Rise delay={delay} style={{ left: LEFT, top, width: WIDTH }}>
      {lines.map((l, i) => (
        <div key={i} style={{ fontFamily: FONT, fontWeight: 800, fontSize: px, lineHeight: `${px * 1.16}px`, color: '#fff', whiteSpace: 'nowrap' }}>{l}</div>
      ))}
    </Rise>
  );
}

/** The outro's hilads.live line: the app logo and the text ("hilads.live" in orange), at most half the question's size. */
function Cta({ text, question }) {
  const { px: questionPx } = fit(question, 1226, 104, 56, OUTRO_QUESTION_BOTTOM);
  const room = WIDTH - CTA_LOGO - 20;
  let px = Math.min(34, Math.floor(questionPx / 2));
  while (px > 24 && measure(text, px, 600) > room) px -= 2;
  const parts = text.split(/(hilads\.live)/i).filter(Boolean);
  return (
    <Rise delay={24} style={{ left: LEFT, top: CTA_TOP, height: CTA_LOGO, display: 'flex', alignItems: 'center', gap: 20 }}>
      <Img src={staticFile('logo.svg')} style={{ width: CTA_LOGO, height: CTA_LOGO }} />
      <span style={{ fontFamily: FONT, fontSize: px, fontWeight: 600, color: 'rgba(255,255,255,0.9)', whiteSpace: 'nowrap' }}>
        {parts.map((p, i) => /^hilads\.live$/i.test(p) ? <span key={i} style={{ fontWeight: 800, color: ACCENT }}>{p}</span> : <span key={i}>{p}</span>)}
      </span>
    </Rise>
  );
}

function Slide({ slide, length }) {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, FADE], [0, 1], { extrapolateRight: 'clamp' });
  const zoom = interpolate(frame, [0, length + FADE], [1, 1.07]);
  const bar = interpolate(frame, [4, 14], [0, 88], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const flagIn = useIn(4);
  const country = slide.kind === 'country';
  const credit = plain(slide.credit);

  return (
    <AbsoluteFill style={{ background: BG, opacity: fadeIn }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: 1080, overflow: 'hidden' }}>
        {slide.photo
          ? <Img src={staticFile(slide.photo)} style={{ width: 1080, height: 1080, objectFit: 'cover', transform: `scale(${zoom})`, transformOrigin: '50% 45%' }} />
          : <div style={{ width: 1080, height: 1080, background: `linear-gradient(135deg, ${ACCENT}, #D9622A)` }} />}
      </div>
      <div style={{ position: 'absolute', left: 0, top: 930, width: 1080, height: 152, background: `linear-gradient(to bottom, rgba(22,17,13,0), ${BG})` }} />

      {/* The series mark, on every slide. */}
      <div style={{ position: 'absolute', left: LEFT, top: 996, height: 56, borderRadius: 28, background: 'rgba(22,17,13,0.9)', display: 'flex', alignItems: 'center',
                    padding: '0 28px', gap: 12, fontFamily: FONT, fontSize: 24 }}>
        <span style={{ fontWeight: 800, letterSpacing: 2, color: ACCENT }}>DIFFERENT WORLDS</span>
        <span style={{ fontWeight: 600, color: '#fff' }}>by Hilads</span>
      </div>
      {credit && (slide.photo || slide.svg) && (
        <div style={{ position: 'absolute', left: LEFT, top: 1072, width: WIDTH, fontFamily: FONT, fontWeight: 600, fontSize: 18, color: 'rgba(255,255,255,0.55)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{credit}</div>
      )}
      <div style={{ position: 'absolute', left: LEFT, top: 1120, width: bar, height: 8, borderRadius: 4, background: ACCENT }} />

      {country && (
        <>
          {slide.flag && (
            <Img src={staticFile(slide.flag)} style={{ position: 'absolute', left: LEFT, top: 1160, width: 76, height: 76, transform: `scale(${flagIn})` }} />
          )}
          <Rise delay={6} style={{ left: slide.flag ? LEFT + 96 : LEFT, top: 1160, height: 76, display: 'flex', alignItems: 'center',
                                   fontFamily: FONT, fontWeight: 700, fontSize: 56, color: GOLD, whiteSpace: 'nowrap' }}>
            {plain(slide.country)}
          </Rise>
          <Lines text={slide.text} top={1276} max={96} min={48} delay={10} />
        </>
      )}
      {slide.kind === 'hook' && <Lines text={slide.text} top={1164} max={112} min={56} delay={4} />}
      {slide.kind === 'outro' && (
        <>
          <Rise delay={4} style={{ left: LEFT, top: 1162, fontFamily: FONT, fontWeight: 800, fontSize: 34, letterSpacing: 3, color: ACCENT }}>YOUR TURN</Rise>
          <Lines text={slide.text} top={1226} max={104} min={56} delay={10} bottom={slide.cta ? OUTRO_QUESTION_BOTTOM : BOTTOM} />
          {slide.cta && <Cta text={plain(slide.cta)} question={plain(slide.text)} />}
        </>
      )}
    </AbsoluteFill>
  );
}

/** props: {slides: [{kind, text, country?, flag?, credit?, photo?, cta?}]} (paths in the public folder). */
export function WorldsVideo({ slides }) {
  const { parts } = worldsTiming(slides);
  return (
    <AbsoluteFill style={{ background: BG }}>
      {slides.map((slide, i) => (
        <Sequence key={i} from={parts[i].start - (i === 0 ? 0 : FADE)} durationInFrames={parts[i].length + (i === 0 ? 0 : FADE)}>
          <Slide slide={slide} length={parts[i].length} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
