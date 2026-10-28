// The promo's frames. Native, not an ad: the hook is a photo (or your clip)
// with the question as a plain story caption, no logo, URL or app name; the
// comparison in the middle uses the app's design (flag stickers, answer
// bubbles, credits); the brand appears only on the end card.
// One set of parts for the story video (1080×1920) and the carousel (1080×1350).

import { AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from '@remotion/fonts';
import { COPY, answerText, flagEmoji } from './copy.js';

const CREAM = '#FBF5EE';
const INK = '#2A1C13';
const TANGERINE = '#FF7A3D';
const FONT = 'Be Vietnam Pro';
// The hook's caption looks like text typed in Instagram or TikTok, not like our brand.
const NATIVE = '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';

for (const [file, weight] of [['Medium', '500'], ['Bold', '700'], ['ExtraBold', '800']]) {
  loadFont({ family: FONT, url: staticFile(`fonts/BeVietnamPro-${file}.ttf`), weight });
}

// ── Pieces ────────────────────────────────────────────────────────────────────

/** 0 → 1 as the part comes in, from $delay frames; always 1 in a still. */
function useIn(delay = 0, still = false) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return still ? 1 : spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 160 } });
}

function Rise({ delay = 0, still, children, style }) {
  const p = useIn(delay, still);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 40}px)`, ...style }}>{children}</div>;
}

/** Text with its *word* on a block of $fill (DESIGN.md 3.3). */
function Highlighted({ text, fill, ink }) {
  return text.split(/(\*[^*]+\*)/).map((part, i) => part.startsWith('*')
    ? <span key={i} style={{ background: fill, color: ink, borderRadius: 14, padding: '0 14px', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }}>{part.slice(1, -1)}</span>
    : <span key={i}>{part}</span>);
}

/** The question as a story caption: black text on white boxes, line by line, centered. */
function Caption({ text, size, top }) {
  return (
    <div style={{ position: 'absolute', top, left: 70, right: 70, textAlign: 'center', textWrap: 'balance', fontFamily: NATIVE, fontWeight: 700, fontSize: size, lineHeight: 1.36 }}>
      <span style={{ background: '#fff', color: '#000', padding: `${size * 0.1}px ${size * 0.28}px`, borderRadius: size * 0.22,
                     boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }}>
        {text}
      </span>
    </div>
  );
}

/** The round flag sticker: white border, soft warm shadow (DESIGN.md 3.1). */
function Flag({ city, size }) {
  const ring = Math.max(4, Math.round(size / 20));
  return (
    <div style={{ width: size, height: size, borderRadius: size, overflow: 'hidden', border: `${ring}px solid #fff`, flexShrink: 0,
                  boxShadow: '0 6px 18px rgba(42,28,19,0.18)', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {city.flag
        ? <Img src={staticFile(city.flag)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span style={{ fontSize: size * 0.7 }}>{flagEmoji(city.country)}</span>}
    </div>
  );
}

/** The answer's speech bubble: white, ink, radius, a small tail (DESIGN.md 3.2). */
function Bubble({ text, size, delay = 4, still }) {
  const p = useIn(delay, still);
  return (
    <div style={{ position: 'relative', alignSelf: 'flex-start', maxWidth: '100%', transform: `scale(${0.6 + 0.4 * p})`, opacity: p, transformOrigin: 'bottom left' }}>
      <div style={{ background: '#fff', color: INK, fontFamily: FONT, fontWeight: 800, fontSize: size, lineHeight: 1.1,
                    padding: `${size * 0.32}px ${size * 0.5}px`, borderRadius: size * 0.55, boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
                    overflowWrap: 'anywhere' }}>
        {text}
      </div>
      <div style={{ position: 'absolute', left: size * 0.6, bottom: -size * 0.22, width: size * 0.5, height: size * 0.5, background: '#fff',
                    transform: 'rotate(45deg)', borderRadius: 6 }} />
    </div>
  );
}

/** The photographer's camera (the credit pill). */
function Camera({ size }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M9 4h6l1.6 2.4H20a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.4a2 2 0 0 1 2-2h3.4z" fill={INK} />
      <circle cx="12" cy="13" r="4" fill="#fff" /><circle cx="12" cy="13" r="2.4" fill={INK} />
    </svg>
  );
}

// ── Cards ─────────────────────────────────────────────────────────────────────

/** Your clip with the question over it, from the first frame. */
function ClipHook({ clip, question }) {
  const { height } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <OffthreadVideo src={staticFile(clip)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      <Caption text={question} size={64} top={height * 0.26} />
    </AbsoluteFill>
  );
}

/**
 * One city: its photo full-bleed, flag, name, the answer in a bubble, the photographer.
 * With $question, the card opens as the hook: the photo and the question only
 * (and the credit) for $hook frames, then the city and its answer come in.
 * In a still, $question alone makes the hook slide.
 */
function CityCard({ city, locale, post, still, question = null, hook = 0 }) {
  const frame = useCurrentFrame();
  const { durationInFrames, height } = useVideoConfig();
  const zoom = still ? 1.02 : interpolate(frame, [0, durationInFrames], [1, 1.07], { extrapolateRight: 'clamp' });
  const hooking = question !== null && (still || frame < hook);
  const reveal = still ? 0 : hook;
  const answer = answerText(city, locale);
  const medal = { 1: '#FFC93C', 2: '#E3E6EA', 3: '#E8A87C' }[city.podium] ?? null;
  const k = post ? 0.85 : 1;
  return (
    <AbsoluteFill style={{ background: '#000', fontFamily: FONT }}>
      <Img src={staticFile(city.photo)} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})` }} />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.6) 100%)' }} />
      {hooking
        ? <Caption text={question} size={post ? 58 : 64} top={height * (post ? 0.2 : 0.26)} />
        : (
          <Rise delay={reveal} still={still} style={{ position: 'absolute', top: post ? 70 : 150, left: 64, right: 64, display: 'flex', alignItems: 'center', gap: 28 * k }}>
            <Flag city={city} size={124 * k} />
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 84 * k, lineHeight: 1, letterSpacing: -1.5, textShadow: '0 3px 14px rgba(0,0,0,0.45)' }}>
              {city.name[locale]}
            </div>
            {medal && <div style={{ width: 84 * k, height: 84 * k, borderRadius: 84, background: medal, color: INK, fontWeight: 800, fontSize: 44 * k,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', border: '4px solid #fff', flexShrink: 0 }}>#{city.podium}</div>}
          </Rise>
        )}
      <div style={{ position: 'absolute', left: 64, right: 64, bottom: post ? 90 : 220, display: 'flex', flexDirection: 'column', gap: 48 * k }}>
        {!hooking && answer && <Bubble text={answer} size={76 * k} delay={reveal + 4} still={still} />}
        <div style={{ alignSelf: 'flex-start', background: 'rgba(255,255,255,0.92)', color: INK, fontWeight: 700, fontSize: 38 * k, padding: '12px 26px', borderRadius: 60,
                      display: 'flex', alignItems: 'center', gap: 12 }}>
          <Camera size={38 * k} />@{city.username}
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** The end card, the only place for the brand: the small logo and "Play for your city on Hilads". */
function EndCard({ locale, post, still }) {
  const k = post ? 0.85 : 1;
  return (
    <AbsoluteFill style={{ background: CREAM, fontFamily: FONT, color: INK, padding: '0 90px', display: 'flex', flexDirection: 'column',
                           justifyContent: 'center', alignItems: 'center', gap: 56 * k, textAlign: 'center' }}>
      <Rise still={still}><Img src={staticFile('logo.svg')} style={{ width: 120 * k, height: 120 * k, borderRadius: 30 * k }} /></Rise>
      <Rise delay={4} still={still} style={{ fontWeight: 800, fontSize: 92 * k, lineHeight: 1.15, letterSpacing: -2 }}>
        <Highlighted text={COPY[locale].playFor} fill={TANGERINE} ink={INK} />
      </Rise>
    </AbsoluteFill>
  );
}

// ── Compositions ──────────────────────────────────────────────────────────────

/**
 * The story video: the hook (your clip with its sound and the question over it,
 * else the first city's photo with the question), one second per city, the end
 * card. Silent after the clip.
 */
export function PromoVideo({ locale, data, cities, clip, timing }) {
  const question = data.yesterday.question[locale];
  let at = 0;
  const seq = (frames, node, key) => {
    const el = <Sequence key={key} from={at} durationInFrames={frames}>{node}</Sequence>;
    at += frames;
    return el;
  };
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {clip && seq(timing.clip, <ClipHook clip={clip} question={question} />, 'clip')}
      {cities.slice(0, timing.cities).map((city, i) => i === 0 && timing.hook > 0
        ? seq(timing.hook + timing.city, <CityCard city={city} locale={locale} question={question} hook={timing.hook} />, city.proofId)
        : seq(timing.city, <CityCard city={city} locale={locale} />, city.proofId))}
      {seq(timing.end, <EndCard locale={locale} />, 'end')}
    </AbsoluteFill>
  );
}

/** One carousel slide (1080×1350): {kind: hook | city | end, index}. The hook is the first city's photo with the question. */
export function PromoSlide({ locale, data, cities, slide }) {
  if (slide.kind === 'city') return <CityCard city={cities[slide.index]} locale={locale} post still />;
  if (slide.kind === 'end') return <EndCard locale={locale} post still />;
  return <CityCard city={cities[0]} locale={locale} post still question={data.yesterday.question[locale]} />;
}
