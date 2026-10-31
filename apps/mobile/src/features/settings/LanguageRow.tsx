import { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { setLocale, SUPPORTED, DEFAULT_LOCALE, type Locale } from '@/i18n';
import { ListRow, Sheet, SheetScrollView } from '@/ui';

// Language names are always shown in their own language (not translated), the
// standard convention so a user can recognize their language regardless of the
// current UI locale.
const LANG_NAMES: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  vi: 'Tiếng Việt',
  es: 'Español',
  it: 'Italiano',
  'pt-br': 'Português (Brasil)',
  'pt-pt': 'Português (Portugal)',
  de: 'Deutsch',
  nl: 'Nederlands',
  'zh-hans': '简体中文',
  'zh-hant': '繁體中文',
  ja: '日本語',
  ko: '한국어',
  fil: 'Filipino',
  th: 'ไทย',
  id: 'Bahasa Indonesia',
  hi: 'हिन्दी',
  ru: 'Русский',
  ar: 'العربية',
};

const LANG_FLAGS: Record<Locale, string> = {
  en: '🇬🇧',
  fr: '🇫🇷',
  vi: '🇻🇳',
  es: '🇪🇸',
  it: '🇮🇹',
  'pt-br': '🇧🇷',
  'pt-pt': '🇵🇹',
  de: '🇩🇪',
  nl: '🇳🇱',
  'zh-hans': '🇨🇳',
  'zh-hant': '🇹🇼',
  ja: '🇯🇵',
  ko: '🇰🇷',
  fil: '🇵🇭',
  th: '🇹🇭',
  id: '🇮🇩',
  hi: '🇮🇳',
  ru: '🇷🇺',
  ar: '🇸🇦',
};

/**
 * The Language row of Settings: opens a sheet listing every locale, each name
 * in its own language with its flag; the current one is checked.
 */
export function LanguageRow({ divider = false }: { divider?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const { t, i18n } = useTranslation('common');
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const current: Locale = (SUPPORTED as readonly string[]).includes(i18n.language)
    ? (i18n.language as Locale)
    : DEFAULT_LOCALE;

  function choose(code: Locale) {
    setOpen(false);
    if (code !== current) void setLocale(code);
  }

  return (
    <>
      <ListRow icon="language-outline" title={t('language')} value={`${LANG_FLAGS[current]} ${LANG_NAMES[current]}`}
               divider={divider} onPress={() => setOpen(true)} />
      <Sheet visible={open} onClose={() => setOpen(false)} closeLabel={t('close')}>
        <Text style={styles.sheetTitle} accessibilityRole="header">{t('language')}</Text>
        {/* Numeric maxHeight gives the ScrollView a definite bound so it
            sizes to content and scrolls inside the content-sized sheet. */}
        <SheetScrollView style={{ maxHeight: height * 0.6 }} showsVerticalScrollIndicator={false}>
          {SUPPORTED.map((code) => {
            const active = code === current;
            return (
              <TouchableOpacity
                key={code}
                style={styles.option}
                activeOpacity={0.7}
                onPress={() => choose(code)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={styles.optionFlag}>{LANG_FLAGS[code]}</Text>
                <Text style={[styles.optionText, active && styles.optionTextActive]}>{LANG_NAMES[code]}</Text>
                {active && <Ionicons name="checkmark" size={20} color={colors.primaryText} />}
              </TouchableOpacity>
            );
          })}
        </SheetScrollView>
      </Sheet>
    </>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  sheetTitle:       { fontSize: FontSizes.lg, fontWeight: '800', color: c.text, paddingVertical: 4 },
  option:           { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  optionFlag:       { fontSize: 20, lineHeight: 24 },
  optionText:       { flex: 1, fontSize: FontSizes.md, fontWeight: '500', color: c.text },
  optionTextActive: { color: c.primaryText, fontWeight: '700' },
});
