import Svg, { Circle, Ellipse, G, Path, Rect, Text as SvgText } from 'react-native-svg';

/**
 * The Halloween sticker pack (event mode, docs/halloween-audit.md): drawn here,
 * our own art, used when the event has no remote pack (Admin › Daily ›
 * Seasonal events › Remote sticker pack). Each sticker is a 100×100 SVG;
 * frames cover the whole photo. Colors are the sticker's own (art, not UI).
 */

export type StickerId =
  | 'pumpkin' | 'ghost' | 'bat' | 'witch_hat' | 'teeth' | 'skull' | 'spider' | 'candy' | 'cauldron'
  | 'moon' | 'eyes' | 'boo' | 'trick';
export type FrameId = 'web' | 'garland';

const INK = '#2A1C13';
const ORANGE = '#FF8A1F';
const PURPLE = '#6B3FA0';
const WHITE = '#FFFFFF';
const GREEN = '#4E9A3A';

export const STICKERS: StickerId[] = ['pumpkin', 'ghost', 'bat', 'witch_hat', 'teeth', 'skull', 'spider', 'candy', 'cauldron', 'moon', 'eyes', 'boo', 'trick'];
export const FRAMES: FrameId[] = ['web', 'garland'];

export function Sticker({ id, size }: { id: StickerId; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {ART[id]}
    </Svg>
  );
}

const ART: Record<StickerId, React.ReactNode> = {
  pumpkin: (
    <G stroke={INK} strokeWidth={3}>
      <Path d="M50 22 C52 14 58 10 62 10" fill="none" stroke={GREEN} strokeWidth={5} strokeLinecap="round" />
      <Ellipse cx={34} cy={58} rx={22} ry={28} fill={ORANGE} />
      <Ellipse cx={66} cy={58} rx={22} ry={28} fill={ORANGE} />
      <Ellipse cx={50} cy={58} rx={20} ry={30} fill="#FF9B3D" />
      <Path d="M36 50 L44 50 L40 42 Z M56 50 L64 50 L60 42 Z" fill={INK} />
      <Path d="M34 64 Q50 80 66 64 L60 66 L56 62 L50 68 L44 62 L40 66 Z" fill={INK} />
    </G>
  ),
  ghost: (
    <G stroke={INK} strokeWidth={3}>
      <Path d="M22 86 L22 44 C22 22 36 12 50 12 C64 12 78 22 78 44 L78 86 L68 78 L59 88 L50 78 L41 88 L32 78 Z" fill={WHITE} />
      <Ellipse cx={40} cy={42} rx={5} ry={7} fill={INK} />
      <Ellipse cx={60} cy={42} rx={5} ry={7} fill={INK} />
      <Ellipse cx={50} cy={58} rx={6} ry={8} fill={INK} />
    </G>
  ),
  bat: (
    <G stroke={INK} strokeWidth={2.5} fill={PURPLE}>
      <Path d="M50 40 C44 30 30 28 8 34 C18 40 18 48 14 56 C24 52 32 56 38 62 C42 56 46 54 50 56 C54 54 58 56 62 62 C68 56 76 52 86 56 C82 48 82 40 92 34 C70 28 56 30 50 40 Z" />
      <Circle cx={50} cy={46} r={9} />
      <Path d="M44 38 L46 30 L49 37 M56 38 L54 30 L51 37" />
      <Circle cx={46} cy={46} r={2} fill={ORANGE} stroke="none" />
      <Circle cx={54} cy={46} r={2} fill={ORANGE} stroke="none" />
    </G>
  ),
  witch_hat: (
    <G stroke={INK} strokeWidth={3}>
      <Ellipse cx={50} cy={78} rx={42} ry={10} fill={PURPLE} />
      <Path d="M30 76 L52 12 C56 24 62 40 72 76 Z" fill={PURPLE} />
      <Path d="M33 66 Q51 72 69 66 L71 74 Q51 80 31 74 Z" fill={ORANGE} />
      <Rect x={45} y={64} width={12} height={10} rx={2} fill="#FFC93C" />
    </G>
  ),
  teeth: (
    <G stroke={INK} strokeWidth={3}>
      <Path d="M12 40 Q50 30 88 40 Q80 66 50 70 Q20 66 12 40 Z" fill="#C8102E" />
      <Path d="M18 41 L82 41 L80 47 L20 47 Z" fill={WHITE} />
      <Path d="M30 46 L35 64 L40 46 Z M60 46 L65 64 L70 46 Z" fill={WHITE} />
    </G>
  ),
  skull: (
    <G stroke={INK} strokeWidth={3}>
      <Path d="M20 50 C20 26 34 14 50 14 C66 14 80 26 80 50 C80 60 74 66 70 68 L70 82 L30 82 L30 68 C26 66 20 60 20 50 Z" fill={WHITE} />
      <Circle cx={38} cy={50} r={9} fill={INK} />
      <Circle cx={62} cy={50} r={9} fill={INK} />
      <Path d="M50 58 L45 68 L55 68 Z" fill={INK} />
      <Path d="M40 82 L40 74 M50 82 L50 74 M60 82 L60 74" />
    </G>
  ),
  spider: (
    <G stroke={INK} strokeWidth={3} fill="none">
      <Path d="M50 4 L50 34" strokeWidth={1.5} />
      <Path d="M38 50 L18 34 M38 56 L12 56 M38 62 L16 78 M62 50 L82 34 M62 56 L88 56 M62 62 L84 78" />
      <Ellipse cx={50} cy={58} rx={15} ry={17} fill={INK} />
      <Circle cx={50} cy={40} r={9} fill={INK} />
      <Circle cx={46} cy={39} r={2.5} fill={WHITE} stroke="none" />
      <Circle cx={54} cy={39} r={2.5} fill={WHITE} stroke="none" />
    </G>
  ),
  candy: (
    <G stroke={INK} strokeWidth={3}>
      <Path d="M28 50 L10 36 L12 64 Z M72 50 L90 36 L88 64 Z" fill={PURPLE} />
      <Ellipse cx={50} cy={50} rx={24} ry={18} fill={ORANGE} />
      <Path d="M36 40 Q44 50 36 60 M50 34 Q58 50 50 66 M64 40 Q72 50 64 60" stroke={WHITE} strokeWidth={4} fill="none" />
    </G>
  ),
  cauldron: (
    <G stroke={INK} strokeWidth={3}>
      <Path d="M30 30 Q38 20 46 28 Q54 18 62 28 Q70 22 72 32" fill="none" stroke="#7BD148" strokeWidth={5} strokeLinecap="round" />
      <Ellipse cx={50} cy={40} rx={34} ry={8} fill="#7BD148" />
      <Path d="M16 40 Q16 86 50 86 Q84 86 84 40 Z" fill={INK} />
      <Path d="M28 86 L24 94 M72 86 L76 94" />
      <Circle cx={40} cy={36} r={4} fill="#B6F28A" stroke="none" />
      <Circle cx={58} cy={38} r={3} fill="#B6F28A" stroke="none" />
    </G>
  ),
  moon: (
    <G stroke={INK} strokeWidth={3}>
      <Path d="M62 12 C40 14 26 32 28 52 C30 74 52 90 74 84 C56 80 44 64 46 46 C48 30 56 18 62 12 Z" fill="#FFE07A" />
      <Path d="M72 26 L74 32 L80 33 L75 37 L77 43 L72 39 L67 43 L69 37 L64 33 L70 32 Z" fill="#FFE07A" strokeWidth={2} />
    </G>
  ),
  eyes: (
    <G stroke={INK} strokeWidth={3}>
      <Ellipse cx={30} cy={50} rx={20} ry={16} fill="#FFF36B" />
      <Ellipse cx={70} cy={50} rx={20} ry={16} fill="#FFF36B" />
      <Ellipse cx={30} cy={50} rx={4} ry={12} fill={INK} />
      <Ellipse cx={70} cy={50} rx={4} ry={12} fill={INK} />
    </G>
  ),
  boo: (
    <G>
      <Rect x={6} y={26} width={88} height={48} rx={14} fill={PURPLE} stroke={INK} strokeWidth={3} />
      <SvgText x={50} y={62} fontSize={32} fontWeight="900" fill={WHITE} stroke={INK} strokeWidth={1.5} textAnchor="middle">BOO!</SvgText>
    </G>
  ),
  trick: (
    <G>
      <Rect x={4} y={22} width={92} height={56} rx={14} fill={ORANGE} stroke={INK} strokeWidth={3} />
      <SvgText x={50} y={46} fontSize={17} fontWeight="900" fill={INK} textAnchor="middle">TRICK OR</SvgText>
      <SvgText x={50} y={68} fontSize={19} fontWeight="900" fill={WHITE} stroke={INK} strokeWidth={1} textAnchor="middle">TREAT!</SvgText>
    </G>
  ),
};

/** A frame over the whole photo (width × height in points). */
export function Frame({ id, width, height }: { id: FrameId; width: number; height: number }) {
  if (id === 'web') {
    // Cobwebs in two corners.
    const s = Math.min(width, height) * 0.38;
    const web = (
      <G stroke={WHITE} strokeWidth={1.6} fill="none" opacity={0.9}>
        <Path d={`M0 0 L${s} ${s * 0.15} M0 0 L${s * 0.75} ${s * 0.75} M0 0 L${s * 0.15} ${s}`} />
        {[0.3, 0.55, 0.8].map(k => (
          <Path key={k} d={`M${s * k} ${s * 0.15 * k} Q${s * 0.55 * k} ${s * 0.3 * k} ${s * 0.75 * k} ${s * 0.75 * k} Q${s * 0.3 * k} ${s * 0.55 * k} ${s * 0.15 * k} ${s * k}`} />
        ))}
      </G>
    );
    return (
      <Svg width={width} height={height} pointerEvents="none">
        {web}
        <G transform={`translate(${width} 0) scale(-1 1)`}>{web}</G>
      </Svg>
    );
  }
  // A garland of little pumpkins along the top.
  const n = Math.max(5, Math.round(width / 70));
  const step = width / n;
  return (
    <Svg width={width} height={height} pointerEvents="none">
      <Path d={`M0 10 Q${width / 2} ${step * 0.9} ${width} 10`} stroke={INK} strokeWidth={2} fill="none" />
      {Array.from({ length: n }, (_, i) => {
        const x = step * (i + 0.5);
        const t = x / width;
        const y = 10 + 4 * t * (1 - t) * (step * 0.9 - 10) * 0.5 + step * 0.18;
        const r = step * 0.22;
        return (
          <G key={i}>
            <Ellipse cx={x} cy={y} rx={r * 1.2} ry={r} fill={i % 2 ? PURPLE : ORANGE} stroke={INK} strokeWidth={2} />
            <Path d={`M${x} ${y - r} L${x + 2} ${y - r - 5}`} stroke={GREEN} strokeWidth={3} />
          </G>
        );
      })}
    </Svg>
  );
}
