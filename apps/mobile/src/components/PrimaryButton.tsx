import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle, TextStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, FontSizes, Gradients, Radius, Shadows } from '@/constants';

// Shared primary CTA — gradient orange. Single source of truth for every
// primary button on the app: Save profile, Create event, Join, etc. Disabled
// state mirrors web's .cef-submit:disabled (muted gradient + 0.55 opacity, no
// shadow). FAB variant is round + uses the louder fab glow shadow.

type Variant = 'cta' | 'fab';
type Size    = 'md' | 'lg';

type Props = {
  onPress:        () => void;
  label?:         string;
  icon?:          React.ReactNode;
  variant?:       Variant;
  size?:          Size;
  disabled?:      boolean;
  loading?:       boolean;
  style?:         StyleProp<ViewStyle>;
  labelStyle?:    StyleProp<TextStyle>;
  accessibilityLabel?: string;
};

export function PrimaryButton({
  onPress,
  label,
  icon,
  variant = 'cta',
  size    = 'md',
  disabled,
  loading,
  style,
  labelStyle,
  accessibilityLabel,
}: Props) {
  const isFab    = variant === 'fab';
  const inactive = disabled || loading;

  const grad   = inactive ? Gradients.primaryDisabled : Gradients.primary;
  const shadow = inactive ? null : (isFab ? Shadows.fab : Shadows.primaryCta);

  const containerStyle: StyleProp<ViewStyle> = [
    isFab ? styles.fab : styles.cta,
    !isFab && size === 'lg' && styles.ctaLg,
    isFab && size === 'lg' && styles.fabLg,
    inactive && styles.inactive,
    shadow,
    style,
  ];

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [
        containerStyle,
        pressed && !inactive && styles.pressed,
      ]}
    >
      <LinearGradient
        colors={grad.colors}
        start={grad.start}
        end={grad.end}
        style={[
          StyleSheet.absoluteFillObject,
          isFab ? styles.fabGradient : styles.ctaGradient,
        ]}
      />

      <View style={styles.contentRow}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : icon ? (
          icon
        ) : null}
        {label ? (
          <Text style={[isFab ? styles.fabLabel : styles.ctaLabel, labelStyle]}>
            {label}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cta: {
    minHeight:    52,
    paddingHorizontal: 22,
    borderRadius: Radius.lg,
    alignItems:   'center',
    justifyContent: 'center',
    overflow:     'hidden',
  },
  ctaLg: {
    minHeight:    60,
    paddingHorizontal: 28,
    borderRadius: Radius.lg + 2,
  },
  ctaGradient: {
    borderRadius: Radius.lg,
  },
  ctaLabel: {
    color:         Colors.white,
    fontSize:      FontSizes.md,
    fontWeight:    '700',
    letterSpacing: 0.2,
  },

  fab: {
    width:        58,
    height:       58,
    borderRadius: 29,
    alignItems:   'center',
    justifyContent: 'center',
    overflow:     'hidden',
  },
  fabLg: {
    width:        64,
    height:       64,
    borderRadius: 32,
  },
  fabGradient: {
    borderRadius: 999,
  },
  fabLabel: {
    color:      Colors.white,
    fontSize:   FontSizes.md,
    fontWeight: '700',
  },

  contentRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },

  pressed: {
    opacity: 0.86,
  },

  inactive: {
    opacity: 0.55,
  },
});
