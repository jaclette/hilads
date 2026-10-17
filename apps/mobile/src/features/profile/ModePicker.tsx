import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

type Mode = 'local' | 'exploring';

const OPTIONS: { key: Mode; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'local',     icon: 'location-outline' },
  { key: 'exploring', icon: 'compass-outline' },
];

/** Local / Exploring (it drives the Local / Traveler label): two option cards, the chosen one on the primary tint. */
export function ModePicker({ value, onChange, disabled = false }: { value: Mode | null; onChange: (mode: Mode) => void; disabled?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>{t('modeHeading')}</Text>
      <View style={styles.row} accessibilityRole="radiogroup">
        {OPTIONS.map(o => {
          const on = value === o.key;
          return (
            <TouchableOpacity key={o.key} style={[styles.option, on && styles.optionOn]} onPress={() => onChange(o.key)} disabled={disabled}
                              activeOpacity={0.8} accessibilityRole="radio" accessibilityState={{ selected: on, disabled }}>
              <Ionicons name={o.icon} size={24} color={on ? colors.primaryOnTint : colors.muted} />
              <Text style={[styles.label, on && styles.labelOn]}>{t(`mode.${o.key}.label`)}</Text>
              <Text style={styles.desc}>{t(`mode.${o.key}.desc`)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:     { gap: 6 },
  heading:  { fontSize: FontSizes.xs, fontWeight: '700', color: c.muted },
  row:      { flexDirection: 'row', gap: 10 },
  option:   { flex: 1, alignItems: 'center', gap: 4, minHeight: 96, paddingVertical: 14, paddingHorizontal: 8,
              borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  optionOn: { borderColor: c.primary, backgroundColor: c.primaryTint },
  label:    { fontSize: FontSizes.md, fontWeight: '700', color: c.text },
  labelOn:  { fontWeight: '700', color: c.primaryOnTint },
  desc:     { fontSize: FontSizes.xs, fontWeight: '400', color: c.muted, textAlign: 'center' },
});
