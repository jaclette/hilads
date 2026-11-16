import { ActivityIndicator, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Space, Border, Radius, Type, IconSize, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Tappable } from './Tappable';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * Button (design pass): a pill. primary = tangerine with ink text (the same in both themes),
 * secondary = card with a line border, danger = red outline (delete), link = primary text.
 * md 48 high, sm 44. Pressed: scale 0.97 + haptic (Tappable); disabled 50%; loading = spinner.
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
    <Tappable
      style={[styles.base, variant !== 'link' && (size === 'sm' ? styles.sm : styles.md), styles[variant], disabled && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
    >
      {loading ? <ActivityIndicator color={color} /> : (
        <>
          {icon && <Ionicons name={icon} size={IconSize.md} color={color} />}
          <Text style={[styles.label, size === 'sm' || variant === 'link' ? styles.labelSm : null, { color }]} numberOfLines={1}>{label}</Text>
        </>
      )}
    </Tappable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  base:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm, minHeight: 44 },
  md:        { minHeight: 48, borderRadius: Radius.control, paddingHorizontal: Space.xl },
  sm:        { minHeight: 44, borderRadius: Radius.control, paddingHorizontal: Space.lg },
  primary:   { backgroundColor: c.cta },
  secondary: { backgroundColor: c.bg2, borderWidth: Border, borderColor: c.line },
  danger:    { borderWidth: Border, borderColor: c.red },
  link:      {},
  disabled:  { opacity: 0.5 },
  label:     { ...Type.label },
  labelSm:   { ...Type.body, fontWeight: '800' },
});
