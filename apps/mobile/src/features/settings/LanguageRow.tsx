import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TouchableOpacity, View, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Spacing, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { setLocale, SUPPORTED, DEFAULT_LOCALE, type Locale } from '@/i18n';

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
 * Language picker. `trigger` chooses the affordance:
 *   - 'row'  (default) - a settings-style row (flag + "Language" + current value).
 *   - 'flag' - a compact flag button, used in the profile header.
 * Both open the same modal list. `card` wraps the row in a standalone card
 * (guest layout). The list scales to any number of locales (scrollable) and
 * shows a flag beside each name.
 */
export function LanguageRow({ card = false, trigger = 'row' }: { card?: boolean; trigger?: 'row' | 'flag' }) {
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

  const triggerEl = trigger === 'flag' ? (
    <TouchableOpacity
      style={styles.flagBtn}
      onPress={() => setOpen(true)}
      activeOpacity={0.7}
      accessibilityLabel={t('language')}
    >
      <Text style={styles.flagBtnEmoji}>{LANG_FLAGS[current]}</Text>
      <Ionicons name="chevron-down" size={12} color={colors.muted} />
    </TouchableOpacity>
  ) : (
    <TouchableOpacity style={styles.row} onPress={() => setOpen(true)} activeOpacity={0.7}>
      <Ionicons name="language-outline" size={18} color={colors.muted} />
      <Text style={styles.label}>{t('language')}</Text>
      <Text style={styles.value}>{LANG_FLAGS[current]} {LANG_NAMES[current]}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </TouchableOpacity>
  );

  return (
    <>
      {card ? <View style={styles.card}>{triggerEl}</View> : triggerEl}
      <Modal
        transparent
        visible={open}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t('language')}</Text>
            {/* Numeric maxHeight gives the ScrollView a definite bound so it
                sizes to content and scrolls - a percentage/auto height collapses
                it to zero inside this content-sized sheet (RN flexShrink defaults to 0). */}
            <ScrollView
              style={{ maxHeight: height * 0.6 }}
              contentContainerStyle={styles.sheetListContent}
              showsVerticalScrollIndicator={false}
            >
              {SUPPORTED.map((code) => {
                const active = code === current;
                return (
                  <TouchableOpacity
                    key={code}
                    style={styles.option}
                    activeOpacity={0.7}
                    onPress={() => choose(code)}
                  >
                    <Text style={styles.optionFlag}>{LANG_FLAGS[code]}</Text>
                    <Text style={[styles.optionText, active && styles.optionTextActive]}>
                      {LANG_NAMES[code]}
                    </Text>
                    {active && <Ionicons name="checkmark" size={18} color={colors.accent} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card: {
    backgroundColor:   c.bg2,
    borderWidth:       1,
    borderColor:       c.border,
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
  label: { flex: 1, fontSize: FontSizes.md, color: c.text },
  value: { fontSize: FontSizes.sm, color: c.muted },

  // Compact flag button (profile header)
  flagBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               3,
    paddingHorizontal: 8,
    paddingVertical:   5,
    borderRadius:      Radius.full,
    borderWidth:       1,
    borderColor:       c.border,
    backgroundColor:   c.bg2,
  },
  flagBtnEmoji: { fontSize: 18, lineHeight: 22 },

  modalRoot: {
    flex:            1,
    justifyContent:  'center',
    alignItems:      'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding:         Spacing.xl,
  },
  sheet: {
    width:           '100%',
    maxWidth:        340,
    maxHeight:       '80%',
    backgroundColor: c.bg2,
    borderWidth:     1,
    borderColor:     c.border,
    borderRadius:    Radius.lg,
    paddingVertical: Spacing.sm,
  },
  sheetTitle: {
    fontSize:      FontSizes.sm,
    fontWeight:    '700',
    color:         c.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.md,
    paddingTop:        Spacing.sm,
    paddingBottom:     Spacing.xs,
  },
  sheetListContent: { paddingBottom: Spacing.xs },
  option: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               Spacing.sm,
    paddingVertical:   Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  optionFlag:       { fontSize: 20, lineHeight: 24 },
  optionText:       { flex: 1, fontSize: FontSizes.md, color: c.text },
  optionTextActive: { color: c.accent, fontWeight: '700' },
});
