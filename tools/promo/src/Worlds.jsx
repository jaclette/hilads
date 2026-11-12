// "Different Worlds by Hilads" video (Admin › Worlds): the day's package as a silent 1080×1920 video, one part per
// slide, in the light identity of the reaction format (since 2026-11-12): the photo or clip on top (a slow zoom or pan on
// photos: Ken Burns, alternating), a curved edge into a cream text area, dark text, the headline's accent words in
// terracotta (Baloo 2 headlines, Be Vietnam Pro text), the series mark on the picture. A slide shows its number and
// country ("#2 · Brazil" with its flag), the headline rising in and its detail 0.6 s later (the two-level reveal, nothing
// more); the hook's headline is readable from the first frame and pops with the picture's punch-in. The hook lasts 3.5 s,
// a country 4 to 5 s from its text, the outro 4 s (worldsTiming.js): about 35 s, 40 at most. Music is added in each app
// when publishing. Video mode: a slide's clip plays in the picture's square instead, muted, from its start, slowed down
// when it is a little short (worlds.mjs measures it). The slides' PNGs (backend/api/src/DwSlides.php) follow the same look.

import { AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from './fonts.jsx';
import { DETAIL_DELAY, FADE, FPS, slideSeconds } from './worldsTiming.js';

const CREAM = '#FFF6E9';
const INK = '#2B1A12';
const MUTED = '#6E5444';
const TERRA = '#C24E1C';
const FONT = 'Be Vietnam Pro';
const Q_FONT = 'Baloo 2';
const LEFT = 72;
const WIDTH = 1080 - LEFT - 170;   // the right 170 px stay free for the apps' buttons
const MEDIA = 1080;                // the picture: the top square
const BOTTOM = 1560;               // under it: the apps' caption and buttons
const OUTRO_QUESTION_BOTTOM = 1436; // the outro's question ends above its hilads.live line
const CTA_TOP = 1472;
const CTA_LOGO = 64;
const ROW_TOP = 1100;              // the number, the flag and the country
const HEAD_TOP = 1196;             // a country's headline
// The detail under a headline: smaller, lighter, 1-2 lines (DwSlides::twoLevel).
const DETAIL_MAX = 50;
const DETAIL_MIN = 32;
const DETAIL_LINES = 2;
const DETAIL_GAP = 26;
const DETAIL_LEADING = 1.22;
const LEADING = 1.06;              // Baloo 2 headlines

for (const [file, weight] of [['SemiBold', '600'], ['Bold', '700'], ['ExtraBold', '800']]) {
  loadFont({ family: FONT, url: staticFile(`fonts/BeVietnamPro-${file}.ttf`), weight });
}
loadFont({ family: Q_FONT, url: staticFile('fonts/Baloo2-Variable.ttf'), weight: '400 800' });

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

// ── Text fitting ─────────────────────────────────────────────────────────────

let ctx = null;
function measure(text, px, weight = 800, family = FONT) {
  ctx ??= document.createElement('canvas').getContext('2d');
  ctx.font = `${weight} ${px}px "${family}", "${FONT}"`;
  return ctx.measureText(text).width;
}

/** Words with their accent flag (the accent: words of the text, in terracotta). */
function accentWords(text, accent) {
  const a = (accent ?? '').trim().toLowerCase();
  const at = a ? text.toLowerCase().indexOf(a) : -1;
  const out = [];
  let pos = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const start = text.indexOf(word, pos);
    pos = start + word.length;
    out.push({ word, hot: at >= 0 && start >= at && pos <= at + a.length });
  }
  return out;
}

/** Words wrapped to width at px (weight, family): lines of words. */
function wrapWords(words, px, width, weight = 800, family = Q_FONT) {
  const lines = [];
  let line = [];
  for (const w of words) {
    const next = [...line, w];
    if (line.length && measure(next.map((x) => x.word).join(' '), px, weight, family) > width) {
      lines.push(line);
      line = [w];
    } else {
      line = next;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

/** The biggest headline size from max down to min that fits between top and bottom: {px, lines}. */
function fitHead(words, top, max, min, bottom = BOTTOM) {
  let lines = [];
  let px = max;
  for (; px >= min; px -= 4) {
    lines = wrapWords(words, px, WIDTH);
    const height = px * 0.95 + (lines.length - 1) * px * LEADING;
    const widest = Math.max(...lines.map((l) => measure(l.map((x) => x.word).join(' '), px, 800, Q_FONT)));
    if (top + height <= bottom && widest <= WIDTH) break;
  }
  return { px: Math.max(px, min), lines };
}

const headEnd = (fit, top) => Math.round(top + fit.px * 0.95 + (fit.lines.length - 1) * fit.px * LEADING);

/** The detail's size and lines: the biggest from DETAIL_MAX that fits in DETAIL_LINES lines (DwSlides::detailFit). */
function detailFit(text) {
  const words = text.split(/\s+/).filter(Boolean).map((word) => ({ word }));
  const str = (ws) => ws.map((x) => x.word).join(' ');
  for (let px = DETAIL_MAX; px > DETAIL_MIN; px -= 2) {
    const lines = wrapWords(words, px, WIDTH, 600, FONT);
    if (lines.length === 1) return { px, lines: [str(lines[0])] };
    if (lines.length <= DETAIL_LINES) {
      // Two lines, balanced: no word (or emoji) alone on the second line.
      let best = [str(lines[0]), str(lines[1])];
      const w = (t) => measure(t, px, 600);
      for (let k = 1; k < words.length; k++) {
        const l1 = str(words.slice(0, k)), l2 = str(words.slice(k));
        if (w(l1) <= WIDTH && w(l2) <= WIDTH && Math.max(w(l1), w(l2)) < Math.max(w(best[0]), w(best[1]))) best = [l1, l2];
      }
      return { px, lines: best };
    }
  }
  return { px: DETAIL_MIN, lines: wrapWords(words, DETAIL_MIN, WIDTH, 600, FONT).map((l) => l.map((x) => x.word).join(' ')) };
}

/** The country name alone (flags are drawn as images). */
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

function HeadLines({ fit }) {
  return fit.lines.map((l, i) => (
    <div key={i} style={{ fontFamily: `"${Q_FONT}", "${FONT}"`, fontWeight: 800, fontSize: fit.px, lineHeight: `${fit.px * LEADING}px`, whiteSpace: 'nowrap',
                          letterSpacing: -0.5, paddingTop: i === 0 ? fit.px * 0.06 : 0 }}>
      {l.map((w, j) => <span key={j} style={{ color: w.hot ? TERRA : INK }}>{j ? ' ' : ''}{w.word}</span>)}
    </div>
  ));
}

/**
 * The headline from top, then its detail DETAIL_DELAY frames later (the two-level reveal): the detail's size first,
 * the headline in the room left above it. pop: the hook's headline scales up (92% → 100%) instead of rising.
 */
function TwoLevel({ text, accent, detail, top, max, min, delay, pop = false }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const det = (detail ?? '').trim();
  let bottom = BOTTOM;
  let dfit = null;
  if (det) {
    dfit = detailFit(det);
    bottom = BOTTOM - DETAIL_GAP - Math.round(dfit.px * 0.95 + (dfit.lines.length - 1) * dfit.px * DETAIL_LEADING);
  }
  const fit = fitHead(accentWords((text ?? '').trim(), accent), top, max, min, bottom);
  const p = spring({ frame: frame - delay, fps, config: { damping: 12, stiffness: 320, mass: 0.5 } });
  return (
    <>
      {pop
        ? <div style={{ position: 'absolute', left: LEFT, top, width: WIDTH, opacity: 0.92 + 0.08 * Math.min(1, p), transform: `scale(${0.92 + 0.08 * p})`,
                        transformOrigin: '0% 50%' }}><HeadLines fit={fit} /></div>
        : <Rise delay={delay} style={{ left: LEFT, top, width: WIDTH }}><HeadLines fit={fit} /></Rise>}
      {dfit && (
        <Rise delay={delay + DETAIL_DELAY} style={{ left: LEFT, top: headEnd(fit, top) + DETAIL_GAP, width: WIDTH }}>
          {dfit.lines.map((l, i) => (
            <div key={i} style={{ fontFamily: FONT, fontWeight: 600, fontSize: dfit.px, lineHeight: `${dfit.px * DETAIL_LEADING}px`, color: MUTED,
                                  whiteSpace: 'nowrap' }}>{l}</div>
          ))}
        </Rise>
      )}
    </>
  );
}

/** The slide's number and country ("#2" in terracotta, the flag, the name). */
function CountryRow({ slide, delay }) {
  const flagIn = useIn(delay);
  const name = plain(slide.country);
  const num = slide.number != null ? `#${slide.number}` : '';
  const numW = num ? measure(num, 52, 800, Q_FONT) + 18 : 0;
  return (
    <>
      {num && <Rise delay={delay} style={{ left: LEFT, top: ROW_TOP, height: 72, display: 'flex', alignItems: 'center', fontFamily: `"${Q_FONT}"`,
                                            fontWeight: 800, fontSize: 52, color: TERRA, paddingTop: 6 }}>{num}</Rise>}
      {slide.flag && (
        <Img src={staticFile(slide.flag)} style={{ position: 'absolute', left: LEFT + numW, top: ROW_TOP + 4, width: 64, height: 64, transform: `scale(${flagIn})` }} />
      )}
      <Rise delay={delay + 2} style={{ left: LEFT + numW + (slide.flag ? 80 : 0), top: ROW_TOP, height: 72, display: 'flex', alignItems: 'center',
                                       fontFamily: FONT, fontWeight: 700, fontSize: 44, color: INK, whiteSpace: 'nowrap' }}>{name}</Rise>
    </>
  );
}

/** The outro's hilads.live line: the app logo and the text ("hilads.live" in terracotta). */
function Cta({ text }) {
  const room = WIDTH - CTA_LOGO - 20;
  let px = 34;
  while (px > 24 && measure(text, px, 600) > room) px -= 2;
  const parts = text.split(/(hilads\.live)/i).filter(Boolean);
  return (
    <Rise delay={24} style={{ left: LEFT, top: CTA_TOP, height: CTA_LOGO, display: 'flex', alignItems: 'center', gap: 20 }}>
      <Img src={staticFile('logo.svg')} style={{ width: CTA_LOGO, height: CTA_LOGO }} />
      <span style={{ fontFamily: FONT, fontSize: px, fontWeight: 600, color: INK, whiteSpace: 'nowrap' }}>
        {parts.map((p, i) => /^hilads\.live$/i.test(p) ? <span key={i} style={{ fontWeight: 800, color: TERRA }}>{p}</span> : <span key={i}>{p}</span>)}
      </span>
    </Rise>
  );
}

/**
 * The picture's movement. Hook: a punch-in (115% → 100% in about 0.35 s, a small overshoot), then a slow zoom. Other
 * slides: a slow Ken Burns, zooming in or out and drifting left or right by turns (about 8%).
 */
function photoMotion(kind, index, frame, length, fps) {
  if (kind === 'hook') {
    const punch = spring({ frame, fps, config: { damping: 11, stiffness: 260, mass: 0.7 } });
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
  const row = slide.country && (slide.kind === 'country' || hook);
  const credit = (slide.credit ?? '').trim();
  const youWords = (q) => (q ?? '').trim().split(/\s+/).filter(Boolean).map((word) => ({ word, hot: /^YOU(R)?\b/.test(word) }));

  return (
    <AbsoluteFill style={{ background: CREAM, opacity: fadeIn }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: MEDIA, overflow: 'hidden', background: '#7a3b1a' }}>
        {slide.clip
          ? <OffthreadVideo src={staticFile(slide.clip.src)} muted playbackRate={slide.clip.rate} trimBefore={Math.round(slide.clip.start * FPS)}
                            style={{ width: 1080, height: MEDIA, objectFit: 'cover' }} />
          : slide.photo
            ? <Img src={staticFile(slide.photo)} style={{ width: 1080, height: MEDIA, objectFit: 'cover', ...photoMotion(slide.kind, index, frame, length, fps) }} />
            : <div style={{ width: 1080, height: MEDIA, background: 'linear-gradient(135deg, #F2A35E, #D9622A)' }} />}
      </div>
      {/* The curved edge into the text area (as the reaction format). */}
      <svg width={1080} height={90} viewBox="0 0 400 34" preserveAspectRatio="none" style={{ position: 'absolute', left: 0, top: MEDIA - 88 }}>
        <path d="M0 22 C70 34 120 4 200 10 C270 15 320 30 400 14 L400 35 L0 35Z" fill={CREAM} />
      </svg>
      {/* The series mark, on the picture (top left, under the apps' top bar), and the picture's credit (top right). */}
      <div style={{ position: 'absolute', left: 32, top: 150, height: 44, display: 'flex', alignItems: 'center', gap: 10,
                    background: 'rgba(255,246,233,0.92)', borderRadius: 22, padding: '0 16px 0 6px' }}>
        <Img src={staticFile('logo.svg')} style={{ width: 34, height: 34 }} />
        <div style={{ fontFamily: FONT, fontSize: 21 }}><span style={{ fontWeight: 800, letterSpacing: 2, color: TERRA }}>DIFFERENT WORLDS</span> <span style={{ fontWeight: 600, color: INK }}>by Hilads</span></div>
      </div>
      {credit && (slide.photo || slide.clip) && (
        <div style={{ position: 'absolute', right: 24, top: 210, maxWidth: 600, fontFamily: FONT, fontSize: 18, fontWeight: 600, color: 'rgba(255,255,255,0.88)',
                      background: 'rgba(0,0,0,0.4)', borderRadius: 14, padding: '4px 12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{credit}</div>
      )}

      {row && <CountryRow slide={slide} delay={hook ? 0 : 4} />}
      {slide.kind === 'country' && <TwoLevel text={slide.text} accent={slide.accent} detail={slide.detail} top={HEAD_TOP} max={96} min={52} delay={10} />}
      {/* The hook's headline is there from the first frame and pops with the picture's punch-in; its detail 0.6 s later. */}
      {hook && <TwoLevel text={slide.text} accent={slide.accent} detail={slide.detail} top={row ? HEAD_TOP : 1130} max={112} min={56} delay={0} pop />}
      {slide.kind === 'outro' && (
        <>
          <Rise delay={4} style={{ left: LEFT, top: 1110, fontFamily: FONT, fontWeight: 800, fontSize: 34, letterSpacing: 3, color: TERRA }}>YOUR TURN</Rise>
          <Rise delay={10} style={{ left: LEFT, top: 1170, width: WIDTH }}>
            <HeadLines fit={fitHead(youWords(slide.text), 1170, 104, 56, slide.cta ? OUTRO_QUESTION_BOTTOM : BOTTOM)} />
          </Rise>
          {slide.cta && <Cta text={slide.cta} />}
        </>
      )}
    </AbsoluteFill>
  );
}

/** props: {slides: [{kind, text, accent?, detail?, number?, country?, flag?, credit?, photo?, clip?: {src, rate, start}, cta?}]} (paths in the public folder). */
export function WorldsVideo({ slides }) {
  const { parts } = worldsTiming(slides);
  return (
    <AbsoluteFill style={{ background: CREAM }}>
      {slides.map((slide, i) => (
        <Sequence key={i} from={parts[i].start - (i === 0 ? 0 : FADE)} durationInFrames={parts[i].length + (i === 0 ? 0 : FADE)}>
          <Slide slide={slide} index={i} length={parts[i].length} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
