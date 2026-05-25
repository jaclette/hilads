import { Alert, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import { setLocale, SUPPORTED, DEFAULT_LOCALE, type Locale } from '@/i18n';

// Language names are always shown in their own language (not translated), the
// standard convention so a user can recognize their language regardless of the
// current UI locale.
const LANG_NAMES: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  vi: 'Tiếng Việt',
};

/**
 * Language picker row for the Profile screen. Renders a single settings-style
 * row; pass `card` to wrap it in a standalone card (used in the guest layout,
 * which has no surrounding settings card).
 */
export function LanguageRow({ card = false }: { card?: boolean }) {
  const { t, i18n } = useTranslation('common');
  const current: Locale = (SUPPORTED as readonly string[]).includes(i18n.language)
    ? (i18n.language as Locale)
    : DEFAULT_LOCALE;

  function openPicker() {
    Alert.alert(t('language'), undefined, [
      ...SUPPORTED.map((code) => ({
        text: LANG_NAMES[code] + (code === current ? '  ✓' : ''),
        onPress: () => { void setLocale(code); },
      })),
      { text: t('cancel'), style: 'cancel' as const },
    ]);
  }

  const row = (
    <TouchableOpacity style={styles.row} onPress={openPicker} activeOpacity={0.7}>
      <Ionicons name="language-outline" size={18} color={Colors.muted} />
      <Text style={styles.label}>{t('language')}</Text>
      <Text style={styles.value}>{LANG_NAMES[current]}</Text>
      <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
    </TouchableOpacity>
  );

  return card ? <View style={styles.card}>{row}</View> : row;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor:   Colors.bg2,
    borderWidth:       1,
    borderColor:       Colors.border,
    borderRadius:      Radius.lg,
    paddingHorizontal: Spacing.md,
    marginHorizontal:  Spacing.lg,
    marginTop:         Spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.sm,
    paddingVertical: Spacing.md,
  },
  label: { flex: 1, fontSize: FontSizes.md, color: Colors.text },
  value: { fontSize: FontSizes.sm, color: Colors.muted },
});
