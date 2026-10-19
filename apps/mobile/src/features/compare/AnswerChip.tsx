import { Text, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import type { DailyAnswer } from '@/types';
import { answerText } from './format';

/** A proof's answer to the comparison question (SPEC 10.2): "Prost!", "37 years", "7:30 PM". */
export function AnswerChip({ answer, onDark = false, style }: { answer: DailyAnswer; onDark?: boolean; style?: StyleProp<ViewStyle> }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { i18n } = useTranslation();
  return (
    <View style={[styles.chip, onDark && styles.chipDark, style]}>
      <Ionicons name="earth-outline" size={13} color={onDark ? colors.white : colors.primaryOnTint} />
      <Text style={[styles.text, onDark && styles.textDark]} numberOfLines={2}>{answerText(answer, i18n.language)}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  chip:     { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', maxWidth: '100%',
              paddingHorizontal: 9, paddingVertical: 4, borderRadius: Radius.full, backgroundColor: c.primaryTint },
  chipDark: { backgroundColor: c.onPhotoFill },
  text:     { flexShrink: 1, fontSize: FontSizes.xs, fontWeight: '700', color: c.primaryOnTint },
  textDark: { color: c.white },
});
