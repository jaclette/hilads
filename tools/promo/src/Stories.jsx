// Story frames to recruit players (Instagram and TikTok, 1080×1920): four
// frames in the joyful design (bright grounds, flag stickers, speech bubbles),
// each as a still PNG and a 5-second MP4. Text stays between y 250 and 1580
// (Instagram's top bar and reply bar cover the rest). The sticker areas are
// left empty on the frames; `guide` draws them, with the covered bands, on a
// separate guide image.

import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { Bubble, Flag, Highlighted, Rise, useIn } from './Promo.jsx';

const INK = '#2A1C13';
const FONT = 'Be Vietnam Pro';
export const TOP = 250;     // Instagram's top bar
export const BOTTOM = 340;  // Instagram's reply bar
const SAFE_END = 1920 - BOTTOM;

export const STORY_COPY = {
  en: {
    help: 'I need your help 🙏',
    missing: 'One country, one player. I’m still missing *yours*.',
    halloween: ['Saturday, the whole world plays the same *Halloween* challenge.', 'Who represents *your city*?'],
    generic: ['Every day, the whole world plays the *same challenge*.', 'Who represents *your city*?'],
    loop: ['One challenge a day.', 'One photo.', 'Your city on the *world map*.'],
    play: 'Play for *your city* 👇',
    you: 'Your photo here',
  },
  fr: {
    help: 'J’ai besoin de vous 🙏',
    missing: 'Un pays, un joueur. Il me manque le *tien*.',
    halloween: ['Samedi, le monde entier fait le même défi d’*Halloween*.', 'Qui représente *ta ville* ?'],
    generic: ['Chaque jour, le monde entier fait le *même défi*.', 'Qui représente *ta ville* ?'],
    loop: ['Un défi par jour.', 'Une photo.', 'Ta ville sur la *carte du monde*.'],
    play: 'Joue pour *ta ville* 👇',
    you: 'Ta photo ici',
  },
};

// The sticker areas each frame leaves empty (x, y, w, h), drawn on the guides only.
export const AREAS = {
  board: [{ label: 'Question sticker', x: 150, y: 1190, w: 780, h: 360 }],
  play: [
    { label: 'Link sticker', x: 190, y: 760, w: 700, h: 170 },
    { label: 'Countdown sticker', x: 140, y: 1040, w: 800, h: 400 },
  ],
};

const flag = (country) => ({ country, flag: `flags/${country}.svg` });

/** A slow float, so the stickers keep living after they pop in; still in a PNG. */
function useFloat(still, phase = 0, amount = 10) {
  const frame = useCurrentFrame();
  return still ? 0 : Math.sin(frame / 18 + phase) * amount;
}

/** A flag sticker that pops in, tilted, and floats. */
function Sticker({ country, size, x, y, rotate = 0, delay = 0, still }) {
  const p = useIn(delay, still);
  const float = useFloat(still, x / 97, 8);
  return (
    <div style={{ position: 'absolute', left: x, top: y + float, transform: `scale(${p}) rotate(${rotate}deg)` }}>
      <Flag city={flag(country)} size={size} />
    </div>
  );
}

/** Lines of big text, each with its *highlight*, coming in one after another. */
function Lines({ lines, size, fill, ink, color, delay = 0, still, gap = 30, style }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap, fontFamily: FONT, fontWeight: 800, fontSize: size, lineHeight: 1.18,
                  letterSpacing: -1.5, color, textWrap: 'balance', ...style }}>
      {lines.map((line, i) => (
        <Rise key={i} delay={delay + i * 6} still={still}><Highlighted text={line} fill={fill} ink={ink} /></Rise>
      ))}
    </div>
  );
}

function Confetti({ colors, seed = 1 }) {
  const dots = Array.from({ length: 26 }, (_, i) => {
    const r = (n) => ((Math.sin(seed * 99 + i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
    // Only on the edges and in the covered bands, never on the text.
    const side = r(6);
    const x = side < 0.5 ? (r(7) < 0.5 ? r(1) * 70 : 1010 + r(1) * 60) : r(1) * 1080;
    const y = side < 0.5 ? r(2) * 1920 : (r(8) < 0.5 ? r(2) * 230 : 1600 + r(2) * 320);
    return { x, y, s: 10 + r(3) * 16, c: colors[i % colors.length], round: r(4) > 0.5, rot: r(5) * 90 };
  });
  return dots.map((d, i) => (
    <div key={i} style={{ position: 'absolute', left: d.x, top: d.y, width: d.s, height: d.round ? d.s : d.s * 0.45, background: d.c,
                          borderRadius: d.round ? d.s : 3, transform: `rotate(${d.rot}deg)`, opacity: 0.85 }} />
  ));
}

// ── Frames ────────────────────────────────────────────────────────────────────

/** 1. Your photo, "I need your help", one country one player. */
function Help({ locale, photo, still }) {
  const c = STORY_COPY[locale];
  const p = useIn(2, still);
  const float = useFloat(still, 0, 6);
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(180deg, #FF8F57 0%, #FF7A3D 100%)' }}>
      <Confetti colors={['#FFC93C', '#FFFFFF', '#5B5BD6', '#1FB5A8']} seed={1} />
      <div style={{ position: 'absolute', left: 250, top: 300 + float, width: 580, height: 700, transform: `rotate(-4deg) scale(${0.7 + 0.3 * p})`, opacity: p,
                    background: '#fff', padding: 18, borderRadius: 44, boxShadow: '0 24px 60px rgba(42,28,19,0.28)' }}>
        {photo
          ? <Img src={staticFile(photo)} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 30 }} />
          : <div style={{ width: '100%', height: '100%', borderRadius: 30, background: '#FBF5EE', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontFamily: FONT, fontWeight: 800, fontSize: 44, color: '#B9A595' }}>{c.you}</div>}
      </div>
      <Sticker country="vn" size={150} x={110} y={330} rotate={-10} delay={10} still={still} />
      <Sticker country="br" size={130} x={830} y={420} rotate={12} delay={13} still={still} />
      <Sticker country="jp" size={120} x={150} y={840} rotate={8} delay={16} still={still} />
      <Sticker country="fr" size={140} x={840} y={800} rotate={-8} delay={19} still={still} />
      <div style={{ position: 'absolute', left: 80, right: 80, top: 1010, display: 'flex', flexDirection: 'column', gap: 70 }}>
        <Bubble text={c.help} size={76} delay={14} still={still} />
        <Lines lines={[c.missing]} size={66} fill="#FFFFFF" ink={INK} color={INK} delay={22} still={still} />
      </div>
    </AbsoluteFill>
  );
}

/** 2. The board: flags that play, "?" for the countries still missing; room for a question sticker. */
function Board({ locale, halloween, still }) {
  const c = STORY_COPY[locale];
  const frame = useCurrentFrame();
  const night = halloween;
  const slots = ['fr', null, 'vn', 'jp', null, null, 'br', null, 'de', 'mx', 'kr', null, 'pt', null, 'th'];
  return (
    <AbsoluteFill style={{ background: night ? 'linear-gradient(180deg, #4B3FC4 0%, #2E2585 100%)' : 'linear-gradient(180deg, #2CC4B6 0%, #1FB5A8 100%)' }}>
      <Confetti colors={night ? ['#FF7A3D', '#FFC93C', '#FFFFFF'] : ['#FFC93C', '#FFFFFF', '#FF7EB0']} seed={2} />
      <Lines lines={night ? c.halloween : c.generic} size={64} fill={night ? '#FF7A3D' : '#FFFFFF'} ink={INK} color={night ? '#FFFFFF' : INK}
             still={still} style={{ position: 'absolute', left: 90, right: 90, top: TOP + 40 }} />
      <div style={{ position: 'absolute', left: 90, right: 90, top: 760, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', rowGap: 26, justifyItems: 'center' }}>
        {slots.map((country, i) => {
          const p = useIn(14 + i * 2, still);
          const pulse = still || country ? 1 : 1 + Math.sin(frame / 8 + i) * 0.05;
          return (
            <div key={i} style={{ transform: `scale(${p * pulse})` }}>
              {country
                ? <Flag city={flag(country)} size={120} />
                : <div style={{ width: 120, height: 120, borderRadius: 120, border: `6px dashed ${night ? '#FFC93C' : '#FFFFFF'}`, boxSizing: 'border-box',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, fontWeight: 800, fontSize: 60,
                                color: night ? '#FFC93C' : '#FFFFFF', background: 'rgba(255,255,255,0.12)' }}>?</div>}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

/** 3. One challenge a day, the app's Today screen. */
function Loop({ locale, still }) {
  const c = STORY_COPY[locale];
  const p = useIn(12, still);
  const shot = `screens/today-${locale}.png`;
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(180deg, #FFE066 0%, #FEC83B 100%)', overflow: 'hidden' }}>
      <Lines lines={c.loop} size={72} fill="#FF7A3D" ink={INK} color={INK} gap={10} still={still}
             style={{ position: 'absolute', left: 90, right: 90, top: TOP + 30 }} />
      {/* The store screenshot's phone and stickers, under its caption, faded into the ground. */}
      <div style={{ position: 'absolute', left: 0, top: 640 + (1 - p) * 300, width: 1080, height: 1900, opacity: p, overflow: 'hidden',
                    WebkitMaskImage: 'linear-gradient(180deg, transparent 0, #000 90px)' }}>
        <Img src={staticFile(shot)} style={{ position: 'absolute', left: 0, top: -500 * (1080 / 1206), width: 1080 }} />
      </div>
    </AbsoluteFill>
  );
}

/** 4. Play for your city, room for the link sticker and the countdown. */
function Play({ locale, still }) {
  const c = STORY_COPY[locale];
  const frame = useCurrentFrame();
  const bounce = still ? 0 : Math.abs(Math.sin(frame / 7)) * -16;
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(180deg, #FF96C0 0%, #FF7EB0 100%)' }}>
      <Confetti colors={['#FFC93C', '#FFFFFF', '#3D9BF0', '#FF7A3D']} seed={4} />
      <div style={{ transform: `translateY(${bounce}px)` }}>
        <Lines lines={[c.play]} size={112} fill="#FFFFFF" ink={INK} color={INK} still={still}
               style={{ position: 'absolute', left: 90, right: 90, top: TOP + 90, textAlign: 'center', alignItems: 'center' }} />
      </div>
      <Sticker country="mx" size={120} x={70} y={1480} rotate={-12} delay={10} still={still} />
      <Sticker country="kr" size={100} x={880} y={1500} rotate={10} delay={13} still={still} />
      <Sticker country="pt" size={90} x={900} y={640} rotate={-6} delay={16} still={still} />
    </AbsoluteFill>
  );
}

/** The guide: the frame, the covered bands and the sticker areas. */
function Guide({ areas, children }) {
  const band = (top, height, text) => (
    <div style={{ position: 'absolute', left: 0, right: 0, top, height, background: 'repeating-linear-gradient(45deg, rgba(220,38,38,0.55) 0 22px, rgba(220,38,38,0.3) 22px 44px)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, fontWeight: 800, fontSize: 40, color: '#fff' }}>{text}</div>
  );
  return (
    <AbsoluteFill>
      {children}
      {band(0, TOP, 'Covered by Instagram (250 px): no text')}
      {band(SAFE_END, BOTTOM, 'Covered by Instagram (340 px): no text')}
      {areas.map((a) => (
        <div key={a.label} style={{ position: 'absolute', left: a.x, top: a.y, width: a.w, height: a.h, border: '8px dashed #fff', borderRadius: 36,
                                    background: 'rgba(42,28,19,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontFamily: FONT, fontWeight: 800, fontSize: 52, color: '#fff' }}>{a.label}</div>
      ))}
    </AbsoluteFill>
  );
}

/** One story frame: {frame: help | board | loop | play, locale, halloween, photo, still, guide}. */
export function StoryFrame({ frame, locale, halloween, photo, still, guide }) {
  const node = {
    help: <Help locale={locale} photo={photo} still={still} />,
    board: <Board locale={locale} halloween={halloween} still={still} />,
    loop: <Loop locale={locale} still={still} />,
    play: <Play locale={locale} still={still} />,
  }[frame];
  return guide ? <Guide areas={AREAS[frame] ?? []}>{node}</Guide> : node;
}
