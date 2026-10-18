import { StyleSheet } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { useTheme } from '@/context/ThemeContext';

export type HeaderArtKind = 'hi' | 'map' | 'passport';

/**
 * The line drawing behind a main screen's header (SPEC 9.1): Hi = speech
 * bubbles, Map = contour lines with a dashed route and a pin, Passport = a
 * round stamp, slightly rotated, over guilloche lines. Primary-coloured at
 * about 20% (dark mode: the light orange, a slightly heavier stroke), on the
 * header's right. Decorative. Photos stay reserved for Today's cover.
 * Same drawings as the web's HeaderArt.jsx.
 */
export function HeaderArt({ kind }: { kind: HeaderArtKind }) {
  const { colors, theme } = useTheme();
  const dark = theme === 'dark';
  return (
    <Svg viewBox="0 0 160 96" style={styles.art} fill="none" stroke={dark ? colors.primaryOnTint : colors.primary}
         strokeWidth={dark ? 1.75 : 1.5} strokeLinecap="round" strokeLinejoin="round" opacity={dark ? 0.22 : 0.2}
         accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
      {kind === 'hi' && (
        <>
          <Path d="M58 14h52a12 12 0 0 1 12 12v20a12 12 0 0 1-12 12H84l-12 11V58H58a12 12 0 0 1-12-12V26a12 12 0 0 1 12-12z" />
          <Circle cx={70} cy={36} r={2.5} /><Circle cx={84} cy={36} r={2.5} /><Circle cx={98} cy={36} r={2.5} />
          <Path d="M118 50h26a10 10 0 0 1 10 10v10a10 10 0 0 1-10 10h-3v8l-9-8h-14a10 10 0 0 1-10-10V60a10 10 0 0 1 10-10z" />
          <Path d="M118 63h22M118 70h14" />
        </>
      )}
      {kind === 'map' && (
        <>
          <Path d="M66 48c0-20 22-36 46-34s40 16 38 32-18 34-42 34-42-12-42-32z" />
          <Path d="M80 48c0-12 14-22 30-21s27 10 25 21-12 22-28 22-27-8-27-22z" />
          <Path d="M95 48c0-6 7-11 15-10s13 5 12 11-6 11-14 11-13-5-13-12z" />
          <Path d="M36 90c18-7 32-3 46 1s32 6 54-5" />
          <Path d="M44 74c14-10 28-4 38-12s16-20 34-24" strokeDasharray="4 5" />
          <Path d="M130 14c-6 0-10.5 4.5-10.5 10.5 0 7.5 10.5 18.5 10.5 18.5s10.5-11 10.5-18.5C140.5 18.5 136 14 130 14z" />
          <Circle cx={130} cy={24.5} r={3} />
        </>
      )}
      {kind === 'passport' && (
        <>
          {[14, 26, 38, 50, 62, 74, 86].map((y, i) => (
            <Path key={y} strokeWidth={0.75} d={`M${20 + (i % 2) * 10} ${y} q10 -6 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0`} />
          ))}
          <G transform="rotate(-12 112 48)">
            <Circle cx={112} cy={48} r={32} strokeWidth={2} />
            <Circle cx={112} cy={48} r={25} strokeDasharray="2 3" />
            <Path d="M98 44h28M101 52h22" />
            <Path d="M112 24l1.6 3.4 3.7.4-2.8 2.5.8 3.7-3.3-1.9-3.3 1.9.8-3.7-2.8-2.5 3.7-.4z" />
          </G>
        </>
      )}
    </Svg>
  );
}

const styles = StyleSheet.create({
  art: { position: 'absolute', top: 0, right: 0, bottom: 0, height: '100%', aspectRatio: 160 / 96 },
});
