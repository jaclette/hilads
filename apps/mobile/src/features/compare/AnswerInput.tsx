import { Text, View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { TextField } from '@/ui';
import type { DailyCompare } from '@/types';
import { TimeWheel } from './TimeWheel';
import { maxLength, type AnswerDraft } from './format';

/**
 * The input of a comparison question (SPEC 10.2): a text field with a counter
 * (word 30, text 80), a number pad with the unit, or the half-hour wheel (time).
 */
export function AnswerInput({ compare, draft, onChange, autoFocus = false, placeholder }: {
  compare: DailyCompare;
  draft: AnswerDraft;
  onChange: (d: AnswerDraft) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');

  if (compare.type === 'time') {
    return <TimeWheel value={draft.minutes} onChange={minutes => onChange({ ...draft, minutes })} />;
  }
  if (compare.type === 'number') {
    return (
      <View style={styles.numberRow}>
        <View style={styles.flex}>
          <TextField
            value={draft.text}
            testID="answer-input"
            onChangeText={v => onChange({ ...draft, text: v.replace(/[^0-9]/g, '').slice(0, 10) })}
            keyboardType="number-pad"
            placeholder={placeholder ?? t('compare.numberPlaceholder')}
            autoFocus={autoFocus}
            accessibilityLabel={compare.question}
            returnKeyType="done"
          />
        </View>
        {!!compare.unit && <Text style={styles.unit}>{compare.unit}</Text>}
      </View>
    );
  }
  const max = maxLength(compare.type);
  const n = [...draft.text].length;
  return (
    <View style={styles.textWrap}>
      <TextField
        value={draft.text}
        testID="answer-input"
        onChangeText={v => onChange({ ...draft, text: v.replace(/\n/g, ' ').slice(0, max) })}
        placeholder={placeholder ?? t(compare.type === 'word' ? 'compare.wordPlaceholder' : 'compare.textPlaceholder')}
        autoFocus={autoFocus}
        maxLength={max}
        multiline={compare.type === 'text'}
        accessibilityLabel={compare.question}
        returnKeyType="done"
        blurOnSubmit
      />
      <Text style={[styles.counter, n > max - 5 && styles.counterNear]}>{n} / {max}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  flex:        { flex: 1 },
  numberRow:   { flexDirection: 'row', alignItems: 'center', gap: 12 },
  unit:        { fontSize: FontSizes.md, fontWeight: '700', color: c.text, maxWidth: '45%' },
  textWrap:    { gap: 4 },
  counter:     { alignSelf: 'flex-end', fontSize: 12, color: c.muted },
  counterNear: { color: c.primaryText, fontWeight: '700' },
});
