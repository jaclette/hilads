import Svg, { Circle, Path } from 'react-native-svg';

/**
 * The #1 crown (design pass): drawn, in the medal gold with an ink outline, so it reads on photos
 * and flags alike and matches the icons (never the 👑 emoji, which renders differently per platform).
 */
export function Crown({ size = 26, fill = '#F7B733', stroke = '#2A1C13' }: { size?: number; fill?: string; stroke?: string }) {
  return (
    <Svg width={size} height={size * 0.8} viewBox="0 0 30 24" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M3 8.5 L8.5 14 L15 4.5 L21.5 14 L27 8.5 L25 21 L5 21 Z" fill={fill} stroke={stroke} strokeWidth={1.8} strokeLinejoin="round" />
      <Circle cx={3} cy={7.5} r={2.2} fill={fill} stroke={stroke} strokeWidth={1.5} />
      <Circle cx={15} cy={3.5} r={2.2} fill={fill} stroke={stroke} strokeWidth={1.5} />
      <Circle cx={27} cy={7.5} r={2.2} fill={fill} stroke={stroke} strokeWidth={1.5} />
    </Svg>
  );
}
