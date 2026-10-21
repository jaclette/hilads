import { ActivityIndicator, Text, TouchableOpacity, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * V3 button (SPEC 9.11): primary = tangerine with ink text (DESIGN.md), secondary = card with a
 * line border, danger = red outline (delete), link = primary text. md is 48 high, sm 44; radius 16 (14 sm).
 */
export function Button({ label, onPress, variant = 'primary', size = 'md', icon, loading = false, disabled = false, style, accessibilityLabel, testID }: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'link';
  size?: 'md' | 'sm';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const color = variant === 'primary' ? colors.onCta : variant === 'secondary' ? colors.text : variant === 'danger' ? colors.red : colors.primaryText;
  return (
    <TouchableOpacity
      style={[styles.base, variant !== 'link' && (size === 'sm' ? styles.sm : styles.md), styles[variant], disabled && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
    >
      {loading ? <ActivityIndicator color={color} /> : (
        <>
          {icon && <Ionicons name={icon} size={variant === 'link' ? 20 : 18} color={color} />}
          <Text style={[styles.label, size === 'sm' || variant === 'link' ? styles.labelSm : null, { color }]} numberOfLines={1}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  base:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44 },
  md:        { minHeight: 48, borderRadius: Radius.button, paddingHorizontal: 16 },
  sm:        { minHeight: 44, borderRadius: 14, paddingHorizontal: 14 },
  primary:   { backgroundColor: c.cta },
  secondary: { backgroundColor: c.bg2, borderWidth: Border, borderColor: c.line },
  danger:    { borderWidth: Border, borderColor: c.red },
  link:      {},
  disabled:  { opacity: 0.5 },
  label:     { fontSize: FontSizes.md, fontWeight: '800' },
  labelSm:   { fontSize: FontSizes.sm, fontWeight: '800' },
});
