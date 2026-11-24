import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/**
 * The Launch Season's art: a Ha Long Bay sunset (limestone peaks, a junk boat, a plane on a
 * dotted route, confetti). Fixed event colors, the same in every theme (like the share cards);
 * it covers its box (slice), so it crops nicely in the Today card's narrow strip too.
 */
export const LS = {
  lantern: '#D7263D', mango: '#FFB627', orange: '#FF7A3C', jade: '#0F7B74', deepJade: '#0B4F4C',
  board: '#21160F', boardTile: '#34261B', boardText: '#FFF4E3', boardMuted: '#D8C6B2', sun: '#FFE29A',
} as const;

export function HalongArt({ width, height }: { width: number | string; height: number | string }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 390 196" preserveAspectRatio="xMidYMid slice"
         accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <LinearGradient id="lsSky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={LS.lantern} /><Stop offset="0.45" stopColor={LS.orange} /><Stop offset="0.85" stopColor={LS.mango} />
        </LinearGradient>
        <LinearGradient id="lsSea" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={LS.jade} /><Stop offset="1" stopColor={LS.deepJade} />
        </LinearGradient>
      </Defs>
      <Rect width="390" height="196" fill="url(#lsSky)" />
      <Circle cx="262" cy="112" r="38" fill={LS.sun} />
      <G opacity={0.9}>
        <Rect x="40" y="26" width="6" height="12" rx="2" fill={LS.sun} transform="rotate(25 43 32)" />
        <Rect x="118" y="18" width="6" height="12" rx="2" fill="#FFFFFF" transform="rotate(-30 121 24)" />
        <Circle cx="330" cy="30" r="4" fill={LS.sun} />
        <Rect x="188" y="40" width="6" height="12" rx="2" fill={LS.jade} transform="rotate(50 191 46)" />
        <Circle cx="76" cy="70" r="3.5" fill="#FFFFFF" />
        <Rect x="356" y="64" width="6" height="12" rx="2" fill="#FFFFFF" transform="rotate(-20 359 70)" />
      </G>
      <Path d="M20 96 Q 130 20 230 52" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeDasharray="2 7" strokeLinecap="round" opacity={0.9} />
      <G transform="translate(232 50) rotate(18)">
        <Path d="M0 0 L-16 -4 L-20 0 L-16 4 Z" fill="#FFFFFF" />
        <Path d="M-9 0 L-14 -11 L-10 -11 L-3 0 L-10 11 L-14 11 Z" fill="#FFFFFF" />
      </G>
      <Path d="M0 150 C 20 70, 44 70, 58 150 Z" fill={LS.deepJade} />
      <Path d="M40 150 C 62 96, 84 92, 104 150 Z" fill={LS.jade} />
      <Path d="M300 150 C 318 60, 350 58, 372 150 Z" fill={LS.deepJade} />
      <Path d="M350 150 C 366 104, 384 104, 398 150 Z" fill={LS.jade} />
      <Path d="M150 150 C 166 118, 184 116, 196 150 Z" fill={LS.deepJade} opacity={0.85} />
      <Rect y="148" width="390" height="48" fill="url(#lsSea)" />
      <G stroke={LS.sun} strokeWidth="2" strokeLinecap="round" opacity={0.7}>
        <Path d="M236 162 h52" /><Path d="M246 172 h32" /><Path d="M254 182 h16" />
      </G>
      <G transform="translate(110 150)">
        <Path d="M-22 0 H22 L16 8 H-16 Z" fill={LS.board} />
        <Path d="M-2 0 V-30 L14 -8 Z" fill={LS.lantern} />
        <Path d="M-6 0 V-22 L-18 -4 Z" fill={LS.lantern} />
      </G>
    </Svg>
  );
}
