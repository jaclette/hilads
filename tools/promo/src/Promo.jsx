// The promo's frames in the app's design (DESIGN.md): cream ground, ink text,
// Be Vietnam Pro, the theme's color, flag stickers and answer bubbles.
// One set of parts for the story video (1080×1920) and the carousel (1080×1350).

import { AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from '@remotion/fonts';
import { COPY, answerText, flagEmoji, theme } from './copy.js';

const CREAM = '#FBF5EE';
const INK = '#2A1C13';
const MUTED = '#6F5B4D';
const TANGERINE = '#FF7A3D';
const FONT = 'Be Vietnam Pro';

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
function Bubble({ text, size, still }) {
  const p = useIn(4, still);
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

function ThemeChip({ challenge, locale, size }) {
  const t = theme(challenge.theme);
  return (
    <div style={{ display: 'inline-block', background: t.fill, color: t.ink, fontFamily: FONT, fontWeight: 800, fontSize: size,
                  padding: `${size * 0.3}px ${size * 0.7}px`, borderRadius: size * 2 }}>
      {challenge.themeName?.[locale] ?? ''}
    </div>
  );
}

function Brand({ size, color = INK }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.4 }}>
      <Img src={staticFile('logo.svg')} style={{ width: size * 1.5, height: size * 1.5, borderRadius: size * 0.35 }} />
      <span style={{ fontFamily: FONT, fontWeight: 800, fontSize: size, color, letterSpacing: -1 }}>Hilads</span>
    </div>
  );
}

/** The dashed route line (DESIGN.md 3.4): decorative, in the band under the brand, never under text. */
function Route({ width, height }) {
  return (
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }} aria-hidden>
      <path d={`M -40 ${height * 0.17} C ${width * 0.3} ${height * 0.11}, ${width * 0.6} ${height * 0.2}, ${width + 40} ${height * 0.13}`}
            fill="none" stroke={INK} strokeOpacity={0.3} strokeWidth={5} strokeDasharray="18 16" />
    </svg>
  );
}

// ── Cards ─────────────────────────────────────────────────────────────────────

/** Yesterday's question, the cities and countries, their flags. */
function TitleCard({ data, cities, countries, locale, post, still }) {
  const { width, height } = useVideoConfig();
  const c = COPY[locale];
  const t = theme(data.yesterday.theme);
  const k = post ? 0.8 : 1;
  return (
    <AbsoluteFill style={{ background: CREAM, padding: `${post ? 90 : 150}px 80px`, fontFamily: FONT, color: INK }}>
      <Route width={width} height={height} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 44 * k, height: '100%', position: 'relative' }}>
        <Rise still={still}><Brand size={52 * k} /></Rise>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 44 * k }}>
          <Rise delay={3} still={still}><ThemeChip challenge={data.yesterday} locale={locale} size={40 * k} /></Rise>
          <Rise delay={6} still={still} style={{ fontWeight: 800, fontSize: 60 * k, letterSpacing: -1 }}>
            <Highlighted text={c.tourTitle} fill={t.fill} ink={t.ink} />
          </Rise>
          <Rise delay={9} still={still} style={{ fontWeight: 800, fontSize: 104 * k, lineHeight: 1.05, letterSpacing: -2 }}>
            {data.yesterday.question[locale]}
          </Rise>
          <Rise delay={12} still={still} style={{ fontWeight: 700, fontSize: 44 * k, color: MUTED }}>
            {c.count(cities.length, countries)}
          </Rise>
          <Rise delay={15} still={still} style={{ display: 'flex', flexWrap: 'wrap' }}>
            {cities.slice(0, 9).map((city, i) => (
              <div key={city.proofId} style={{ marginLeft: i === 0 ? 0 : -22 * k }}><Flag city={city} size={104 * k} /></div>
            ))}
          </Rise>
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** One city: its photo full-bleed, flag, name, the answer in a bubble, the photographer. */
function CityCard({ city, locale, post, still }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const zoom = still ? 1.02 : interpolate(frame, [0, durationInFrames], [1, 1.07], { extrapolateRight: 'clamp' });
  const answer = answerText(city, locale);
  const medal = { 1: '#FFC93C', 2: '#E3E6EA', 3: '#E8A87C' }[city.podium] ?? null;
  const k = post ? 0.85 : 1;
  return (
    <AbsoluteFill style={{ background: '#000', fontFamily: FONT }}>
      <Img src={staticFile(city.photo)} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})` }} />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 62%, rgba(0,0,0,0.6) 100%)' }} />
      <div style={{ position: 'absolute', top: post ? 70 : 150, left: 64, right: 64, display: 'flex', alignItems: 'center', gap: 28 * k }}>
        <Flag city={city} size={124 * k} />
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 84 * k, lineHeight: 1, letterSpacing: -1.5, textShadow: '0 3px 14px rgba(0,0,0,0.45)' }}>
          {city.name[locale]}
        </div>
        {medal && <div style={{ width: 84 * k, height: 84 * k, borderRadius: 84, background: medal, color: INK, fontWeight: 800, fontSize: 44 * k,
                                display: 'flex', alignItems: 'center', justifyContent: 'center', border: '4px solid #fff', flexShrink: 0 }}>#{city.podium}</div>}
      </div>
      <div style={{ position: 'absolute', left: 64, right: 64, bottom: post ? 90 : 220, display: 'flex', flexDirection: 'column', gap: 48 * k }}>
        {answer && <Bubble text={answer} size={76 * k} still={still} />}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ background: 'rgba(255,255,255,0.92)', color: INK, fontWeight: 700, fontSize: 38 * k, padding: '12px 26px', borderRadius: 60,
                        display: 'flex', alignItems: 'center', gap: 12 }}>
            <Camera size={38 * k} />@{city.username}
          </div>
          <div style={{ color: '#fff', fontWeight: 700, fontSize: 34 * k, textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>hilads.live</div>
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** Today's question, the tagline and hilads.live. */
function EndCard({ data, locale, post, still }) {
  const { width, height } = useVideoConfig();
  const c = COPY[locale];
  const t = theme(data.today.theme);
  const k = post ? 0.8 : 1;
  return (
    <AbsoluteFill style={{ background: CREAM, padding: `${post ? 90 : 150}px 80px`, fontFamily: FONT, color: INK }}>
      <Route width={width} height={height} />
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
        <Rise still={still}><Brand size={52 * k} /></Rise>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 44 * k }}>
          <Rise delay={3} still={still}><ThemeChip challenge={data.today} locale={locale} size={40 * k} /></Rise>
          <Rise delay={5} still={still} style={{ fontWeight: 800, fontSize: 48 * k, color: MUTED, textTransform: 'uppercase', letterSpacing: 2 }}>
            {c.todayKicker}
          </Rise>
          <Rise delay={8} still={still} style={{ fontWeight: 800, fontSize: 100 * k, lineHeight: 1.05, letterSpacing: -2 }}>
            {data.today.question[locale]}
          </Rise>
          <Rise delay={11} still={still} style={{ fontWeight: 800, fontSize: 72 * k }}>
            <Highlighted text={`*${c.yourTurn}*`} fill={t.fill} ink={t.ink} />
          </Rise>
        </div>
        <Rise delay={14} still={still} style={{ display: 'flex', flexDirection: 'column', gap: 30 * k, alignItems: 'flex-start' }}>
          <div style={{ fontWeight: 800, fontSize: 56 * k, letterSpacing: -1 }}>{c.tagline}</div>
          <div style={{ background: TANGERINE, color: INK, fontWeight: 800, fontSize: 60 * k, padding: '18px 44px', borderRadius: 30 }}>hilads.live</div>
        </Rise>
      </div>
    </AbsoluteFill>
  );
}

// ── Compositions ──────────────────────────────────────────────────────────────

/** The story video: your clip (with its sound), the title card, one second per city, the end card. Silent after the clip. */
export function PromoVideo({ locale, data, cities, countries, clip, timing }) {
  let at = 0;
  const seq = (frames, node, key) => {
    const el = <Sequence key={key} from={at} durationInFrames={frames}>{node}</Sequence>;
    at += frames;
    return el;
  };
  return (
    <AbsoluteFill style={{ background: CREAM }}>
      {clip && seq(timing.clip, <OffthreadVideo src={staticFile(clip)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />, 'clip')}
      {seq(timing.title, <TitleCard data={data} cities={cities} countries={countries} locale={locale} />, 'title')}
      {cities.slice(0, timing.cities).map((city) => seq(timing.city, <CityCard city={city} locale={locale} />, city.proofId))}
      {seq(timing.end, <EndCard data={data} locale={locale} />, 'end')}
    </AbsoluteFill>
  );
}

/** One carousel slide (1080×1350): {kind: title | city | end, index}. */
export function PromoSlide({ locale, data, cities, countries, slide }) {
  if (slide.kind === 'city') return <CityCard city={cities[slide.index]} locale={locale} post still />;
  if (slide.kind === 'end') return <EndCard data={data} locale={locale} post still />;
  return <TitleCard data={data} cities={cities} countries={countries} locale={locale} post still />;
}
