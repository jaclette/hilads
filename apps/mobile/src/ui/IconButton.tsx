import { TouchableOpacity, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Border, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

/**
 * Round 44 px icon button (back, gear, bell, locate), with an optional unread
 * dot. tone="onPhoto": translucent white on a photo or the camera (viewer, camera).
 */
export function IconButton({ icon, onPress, label, badge = false, iconSize = 22, tone = 'default', style, testID }: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  label: string;
  badge?: boolean;
  iconSize?: number;
  tone?: 'default' | 'onPhoto';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <TouchableOpacity style={[styles.round, tone === 'onPhoto' && styles.onPhoto, style]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID}>
      <Ionicons name={icon} size={iconSize} color={tone === 'onPhoto' ? colors.white : colors.text} />
      {badge && <View style={styles.dot} />}
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  round: { width: 44, height: 44, borderRadius: Radius.full, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2,
           alignItems: 'center', justifyContent: 'center' },
  onPhoto: { borderWidth: 0, backgroundColor: c.photoControl },
  dot:   { position: 'absolute', top: 9, right: 10, width: 9, height: 9, borderRadius: Radius.full, backgroundColor: c.primary,
           borderWidth: 2, borderColor: c.bg2 },
});
