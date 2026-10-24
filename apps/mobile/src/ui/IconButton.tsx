import { TouchableOpacity, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Border, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

/**
 * Round 44 px icon button (back, gear, bell, locate), with an optional unread
 * dot. tone="onPhoto": 48 px, white on a dark disc over a photo or the camera
 * (viewer, camera), its touch area 8 px wider all round.
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
    <TouchableOpacity style={[styles.round, tone === 'onPhoto' && styles.onPhoto, style]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID}
                      hitSlop={tone === 'onPhoto' ? ON_PHOTO_SLOP : undefined}>
      <Ionicons name={icon} size={iconSize} color={tone === 'onPhoto' ? colors.white : colors.text} />
      {badge && <View style={styles.dot} />}
    </TouchableOpacity>
  );
}

const ON_PHOTO_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  round: { width: 44, height: 44, borderRadius: Radius.full, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2,
           alignItems: 'center', justifyContent: 'center' },
  onPhoto: { width: 48, height: 48, borderWidth: 0, backgroundColor: c.photoButton },
  dot:   { position: 'absolute', top: 9, right: 10, width: 9, height: 9, borderRadius: Radius.full, backgroundColor: c.primary,
           borderWidth: 2, borderColor: c.bg2 },
});
