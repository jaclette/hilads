import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * The shade that keeps white text readable on a cover photo, behind the text only: put it as the
 * FIRST child of the text block at the bottom of the photo (the block's own padding box). It ramps
 * in above the block (RAMP px, eased, no visible band) and reaches 50% black at the block's top
 * (the title: white 3:1+ on a white cover, WCAG AA large text), 62% a third of the way down (the
 * subtitle: 4.5:1+), 75% at the bottom. The photo above the text keeps its real brightness and colors,
 * and nothing covers the top (chips and buttons there carry their own dark backgrounds).
 * Web: the same stops in index.css (.cover-scrim). Fixed photo tokens: the same in both themes.
 */
export const COVER_SCRIM_RAMP = 72;

const RAMP_COLORS = ['rgba(0,0,0,0)', 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0.16)', 'rgba(0,0,0,0.31)', 'rgba(0,0,0,0.44)', 'rgba(0,0,0,0.5)'] as const;
const RAMP_STOPS = [0, 0.25, 0.5, 0.72, 0.9, 1] as const;
const BLOCK_COLORS = ['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.62)', 'rgba(0,0,0,0.7)', 'rgba(0,0,0,0.75)'] as const;
const BLOCK_STOPS = [0, 0.35, 0.7, 1] as const;

export function CoverScrim({ ramp = COVER_SCRIM_RAMP }: { ramp?: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={RAMP_COLORS} locations={RAMP_STOPS} style={[styles.ramp, { top: -ramp, height: ramp }]} />
      <LinearGradient colors={BLOCK_COLORS} locations={BLOCK_STOPS} style={StyleSheet.absoluteFill} />
    </View>
  );
}

const styles = StyleSheet.create({
  ramp: { position: 'absolute', left: 0, right: 0 },
});
