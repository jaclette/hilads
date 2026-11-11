// "Different Worlds by Hilads" video (Admin › Worlds): the day's package as a
// silent 1080×1920 video, one part per slide, the same layout as the slides the
// API renders (backend/api/src/DwSlides.php): the photo on top with a slow
// zoom or pan (Ken Burns, alternating), the series pill and the photo credit,
// then the flag, the country, the headline rising in and its detail 0.6 s
// later. The hook grabs: its photo punches in (115% → 100%, a small spring),
// its headline, readable from the first frame, pops (92% → 100%) with it. The hook lasts 3.5 s, a country 4 to 5 s
// from its text, the outro 4 s (worldsTiming.js): about 35 s, 40 at most. Music is added in each app when publishing.
// Video mode: a slide's clip plays in the photo's square instead, muted, from
// its start, slowed down when it is a little short (worlds.mjs measures it).

import { AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from './fonts.jsx';
import { DETAIL_DELAY, FADE, FPS, slideSeconds } from './worldsTiming.js';

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
// The detail under a headline: smaller, lighter, 1-2 lines (DwSlides::twoLevel).
const DETAIL_MAX = 52;
const DETAIL_MIN = 34;
const DETAIL_LINES = 2;
const DETAIL_GAP = 30;
const DETAIL_LEADING = 1.2;

for (const [file, weight] of [['SemiBold', '600'], ['Bold', '700'], ['ExtraBold', '800']]) {
  loadFont({ family: FONT, url: staticFile(`fonts/BeVietnamPro-${file}.ttf`), weight });
}

export { FADE, FPS };

/** [{start, length}] in frames for each slide, and the total. Pure. */
export function worldsTiming(slides) {
  let at = 0;
  const parts = slides.map((s) => {
    const length = Math.round(slideSeconds(s) * FPS);
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

/** Where the last line of a Lines block ends (its first line's top is top). */
function textEnd(text, top, max, min, bottom) {
  const { px, lines } = fit(plain(text), top, max, min, bottom);
  return Math.round(top + px * 0.95 + (lines.length - 1) * px * 1.16);
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

/** The detail's size and lines: the biggest from DETAIL_MAX that fits in DETAIL_LINES lines (DwSlides::detailFit). */
function detailFit(text) {
  for (let px = DETAIL_MAX; px > DETAIL_MIN; px -= 4) {
    const lines = wrap(text, px, WIDTH, 600);
    if (lines.length <= DETAIL_LINES && Math.max(...lines.map((l) => measure(l, px, 600))) <= WIDTH) return { px, lines };
  }
  return { px: DETAIL_MIN, lines: wrap(text, DETAIL_MIN, WIDTH, 600) };
}

/** A detail block (top at top), fading and rising in at delay. */
function Detail({ text, top, delay }) {
  const { px, lines } = detailFit(text);
  return (
    <Rise delay={delay} style={{ left: LEFT, top, width: WIDTH }}>
      {lines.map((l, i) => (
        <div key={i} style={{ fontFamily: FONT, fontWeight: 600, fontSize: px, lineHeight: `${px * DETAIL_LEADING}px`, color: 'rgba(255,255,255,0.78)',
                              whiteSpace: 'nowrap' }}>{l}</div>
      ))}
    </Rise>
  );
}

/**
 * The headline from top, then its detail DETAIL_DELAY frames later, laid out as the slides
 * (DwSlides::twoLevel): the detail's size first, the headline in the room left above it.
 * pop: the hook's headline scales up (92% → 100%) instead of rising.
 */
function TwoLevel({ text, detail, top, max, min, delay, pop = false }) {
  const head = plain(text);
  const det = plain(detail);
  let bottom = BOTTOM;
  if (det) {
    const { px, lines } = detailFit(det);
    bottom = BOTTOM - DETAIL_GAP - Math.round(px * 0.95 + (lines.length - 1) * px * DETAIL_LEADING);
  }
  return (
    <>
      {pop ? <Pop text={head} top={top} max={max} min={min} delay={delay} bottom={bottom} />
           : <Lines text={head} top={top} max={max} min={min} delay={delay} bottom={bottom} />}
      {det && <Detail text={det} top={textEnd(head, top, max, min, bottom) + DETAIL_GAP} delay={delay + DETAIL_DELAY} />}
    </>
  );
}

/**
 * The hook's headline: readable from the very first frame (92% scale, nearly opaque), then a
 * quick spring to 100% in about 0.25 s, at the same time as the photo's punch-in.
 */
function Pop({ text, top, max, min, delay, bottom }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: { damping: 12, stiffness: 320, mass: 0.5 } });
  const { px, lines } = fit(text, top, max, min, bottom);
  return (
    <div style={{ position: 'absolute', left: LEFT, top, width: WIDTH, opacity: 0.92 + 0.08 * Math.min(1, p), transform: `scale(${0.92 + 0.08 * p})`, transformOrigin: '0% 50%' }}>
      {lines.map((l, i) => (
        <div key={i} style={{ fontFamily: FONT, fontWeight: 800, fontSize: px, lineHeight: `${px * 1.16}px`, color: '#fff', whiteSpace: 'nowrap' }}>{l}</div>
      ))}
    </div>
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

/**
 * The photo's movement. Hook: a punch-in (115% → 100% in about 0.35 s, a small overshoot),
 * then a slow zoom. Other slides: a slow Ken Burns, zooming in or out and drifting left or
 * right by turns (about 8%), so two slides in a row never move the same way.
 */
function photoMotion(kind, index, frame, length, fps) {
  if (kind === 'hook') {
    const punch = spring({ frame, fps, config: { damping: 11, stiffness: 260, mass: 0.7 } });
    // The slow zoom starts at 103%, so the punch's overshoot never shows an edge.
    const slow = interpolate(frame, [0, length], [1.03, 1.11], { extrapolateRight: 'clamp' });
    return { transform: `scale(${slow * (1 + 0.15 * (1 - punch))})`, transformOrigin: '50% 45%' };
  }
  const t = interpolate(frame, [0, length + FADE], [0, 1], { extrapolateRight: 'clamp' });
  const zoomIn = index % 2 === 1;
  const scale = zoomIn ? 1.02 + 0.08 * t : 1.10 - 0.08 * t;
  const drift = (index % 4 < 2 ? 1 : -1) * 24 * (t - 0.5);
  return { transform: `translateX(${drift}px) scale(${scale})`, transformOrigin: '50% 45%' };
}

function Slide({ slide, index, length }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeIn = index === 0 ? 1 : interpolate(frame, [0, FADE], [0, 1], { extrapolateRight: 'clamp' });
  const hook = slide.kind === 'hook';
  const bar = interpolate(frame, [4, 14], [0, 88], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const flagIn = useIn(4);
  const country = slide.kind === 'country';
  const credit = plain(slide.credit);

  return (
    <AbsoluteFill style={{ background: BG, opacity: fadeIn }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: 1080, overflow: 'hidden' }}>
        {slide.clip
          ? <OffthreadVideo src={staticFile(slide.clip.src)} muted playbackRate={slide.clip.rate} trimBefore={Math.round(slide.clip.start * FPS)}
                            style={{ width: 1080, height: 1080, objectFit: 'cover' }} />
          : slide.photo
            ? <Img src={staticFile(slide.photo)} style={{ width: 1080, height: 1080, objectFit: 'cover', ...photoMotion(slide.kind, index, frame, length, fps) }} />
            : <div style={{ width: 1080, height: 1080, background: `linear-gradient(135deg, ${ACCENT}, #D9622A)` }} />}
      </div>
      <div style={{ position: 'absolute', left: 0, top: 930, width: 1080, height: 152, background: `linear-gradient(to bottom, rgba(22,17,13,0), ${BG})` }} />

      {/* The series mark, on every slide. */}
      <div style={{ position: 'absolute', left: LEFT, top: 996, height: 56, borderRadius: 28, background: 'rgba(22,17,13,0.9)', display: 'flex', alignItems: 'center',
                    padding: '0 28px', gap: 12, fontFamily: FONT, fontSize: 24 }}>
        <span style={{ fontWeight: 800, letterSpacing: 2, color: ACCENT }}>DIFFERENT WORLDS</span>
        <span style={{ fontWeight: 600, color: '#fff' }}>by Hilads</span>
      </div>
      {credit && (slide.photo || slide.svg || slide.clip) && (
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
          <TwoLevel text={slide.text} detail={slide.detail} top={1276} max={96} min={48} delay={10} />
        </>
      )}
      {/* The hook's headline is there from the first frame and pops with the photo's punch-in (with a clip too); its detail 0.6 s later. */}
      {hook && <TwoLevel text={slide.text} detail={slide.detail} top={1164} max={112} min={56} delay={0} pop />}
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

/** props: {slides: [{kind, text, detail?, country?, flag?, credit?, photo?, clip?: {src, rate, start}, cta?}]} (paths in the public folder). */
export function WorldsVideo({ slides }) {
  const { parts } = worldsTiming(slides);
  return (
    <AbsoluteFill style={{ background: BG }}>
      {slides.map((slide, i) => (
        <Sequence key={i} from={parts[i].start - (i === 0 ? 0 : FADE)} durationInFrames={parts[i].length + (i === 0 ? 0 : FADE)}>
          <Slide slide={slide} index={i} length={parts[i].length} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
