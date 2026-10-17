import { Text, TouchableOpacity, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Button } from './Button';

/**
 * A floating notice card: icon, text, an optional action and a close button
 * ("A new version is ready", "We placed you in …"). The caller positions it.
 */
export function Banner({ icon, text, action, onClose, closeLabel, style }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
  action?: { label: string; onPress: () => void };
  onClose: () => void;
  closeLabel: string;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <View style={[styles.banner, style]} accessibilityRole="alert">
      <Ionicons name={icon} size={20} color={colors.primaryText} />
      <Text style={styles.text} numberOfLines={2}>{text}</Text>
      {action && <Button size="sm" label={action.label} onPress={action.onPress} />}
      <TouchableOpacity style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel}>
        <Ionicons name="close" size={20} color={colors.muted} />
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingLeft: 14, paddingRight: 4, paddingVertical: 6,
            borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  text:   { flex: 1, fontSize: FontSizes.sm, fontWeight: '600', color: c.text },
  close:  { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
