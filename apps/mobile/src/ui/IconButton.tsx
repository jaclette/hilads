import { TouchableOpacity, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Border, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

/** Round 44 px icon button (back, gear, bell, locate), with an optional unread dot. */
export function IconButton({ icon, onPress, label, badge = false, iconSize = 22, style }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  label: string;
  badge?: boolean;
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <TouchableOpacity style={[styles.round, style]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={iconSize} color={colors.text} />
      {badge && <View style={styles.dot} />}
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  round: { width: 44, height: 44, borderRadius: Radius.full, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2,
           alignItems: 'center', justifyContent: 'center' },
  dot:   { position: 'absolute', top: 9, right: 10, width: 9, height: 9, borderRadius: Radius.full, backgroundColor: c.primary,
           borderWidth: 2, borderColor: c.bg2 },
});
