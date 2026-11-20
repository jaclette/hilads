import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { FontSizes, Radius, Space, Spacing, type ThemeColors } from '@/constants';
import { Button } from '@/ui';
import { PRECISIONS, PRECISION_ICON, type PhotoPrecision } from '@/features/daily/photoLocation';

/**
 * Where the Daily photo shows (photo location privacy), after the photo and before the
 * rest: Exact spot (pinned on a public place, then the place step), Neighborhood (around it,
 * the exact spot stays private) or City only (not on the Map). Starts on Settings' default.
 * `locationOff`: the app has no location permission: the photo still posts, for the city.
 */
export function WhereStep({ value, onChange, onContinue, city, locationOff }: {
  value: PhotoPrecision;
  onChange: (p: PhotoPrecision) => void;
  onContinue: () => void;
  city: string | null;
  locationOff: boolean;
}) {
  const { t } = useTranslation('daily');
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const sub = (p: PhotoPrecision) => p === 'city'
    ? (city ? t('where.citySub', { city }) : t('where.citySubNoName'))
    : t(`where.${p}Sub`);

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title} accessibilityRole="header">{t('where.title')}</Text>
        <View accessibilityRole="radiogroup">
          {PRECISIONS.map(p => {
            const on = p === value;
            return (
              <TouchableOpacity key={p} style={[styles.option, on && styles.optionOn]} onPress={() => onChange(p)}
                                accessibilityRole="radio" accessibilityState={{ selected: on }} testID={`where-${p}`}>
                <View style={[styles.icon, on && styles.iconOn]}>
                  <Ionicons name={PRECISION_ICON[p]} size={22} color={on ? colors.white : colors.primaryOnTint} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.label}>{t(`where.${p}`)}</Text>
                  <Text style={styles.sub}>{sub(p)}</Text>
                </View>
                <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? colors.primary : colors.muted} />
              </TouchableOpacity>
            );
          })}
        </View>
        {locationOff && value !== 'city' && (
          <View style={styles.note}>
            <Ionicons name="information-circle-outline" size={18} color={colors.muted} />
            <Text style={styles.noteText}>{city ? t('where.locationOff', { city }) : t('where.locationOffNoName')}</Text>
          </View>
        )}
        <Text style={styles.hint}>{t('where.settingHint')}</Text>
      </ScrollView>
      <View style={styles.footer}>
        <Button label={t('where.continue')} onPress={onContinue} testID="where-continue" />
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  flex:      { flex: 1 },
  body:      { padding: Spacing.md, gap: Space.md },
  title:     { fontSize: FontSizes.lg, fontWeight: '800', color: c.text, marginBottom: Space.xs },
  option:    { flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.lg, marginBottom: Space.sm, minHeight: 72,
               borderRadius: Radius.card, borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2 },
  optionOn:  { borderColor: c.primary, backgroundColor: c.primaryTint },
  icon:      { width: 44, height: 44, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primaryTint },
  iconOn:    { backgroundColor: c.primary },
  label:     { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  sub:       { fontSize: FontSizes.sm, color: c.muted, marginTop: 2 },
  note:      { flexDirection: 'row', gap: Space.sm, alignItems: 'flex-start' },
  noteText:  { flex: 1, fontSize: FontSizes.sm, color: c.muted },
  hint:      { fontSize: FontSizes.xs, color: c.muted, textAlign: 'center' },
  footer:    { padding: Spacing.md },
});
