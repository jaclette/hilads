import { useState } from 'react';
import { Modal, Pressable, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
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
};

/**
 * Language picker row for the Profile screen. Renders a single settings-style
 * row; pass `card` to wrap it in a standalone card (used in the guest layout,
 * which has no surrounding settings card).
 *
 * Uses a custom modal list — NOT Alert.alert — because Android's alert dialog
 * only renders up to 3 buttons, so with 4+ locales it silently dropped options
 * (es never appeared). A list scales to any number of languages on both platforms.
 */
export function LanguageRow({ card = false }: { card?: boolean }) {
  const { t, i18n } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const current: Locale = (SUPPORTED as readonly string[]).includes(i18n.language)
    ? (i18n.language as Locale)
    : DEFAULT_LOCALE;

  function choose(code: Locale) {
    setOpen(false);
    if (code !== current) void setLocale(code);
  }

  const row = (
    <TouchableOpacity style={styles.row} onPress={() => setOpen(true)} activeOpacity={0.7}>
      <Ionicons name="language-outline" size={18} color={Colors.muted} />
      <Text style={styles.label}>{t('language')}</Text>
      <Text style={styles.value}>{LANG_NAMES[current]}</Text>
      <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
    </TouchableOpacity>
  );

  return (
    <>
      {card ? <View style={styles.card}>{row}</View> : row}
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
            {SUPPORTED.map((code) => {
              const active = code === current;
              return (
                <TouchableOpacity
                  key={code}
                  style={styles.option}
                  activeOpacity={0.7}
                  onPress={() => choose(code)}
                >
                  <Text style={[styles.optionText, active && styles.optionTextActive]}>
                    {LANG_NAMES[code]}
                  </Text>
                  {active && <Ionicons name="checkmark" size={18} color={Colors.accent} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>
    </>
  );
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
    backgroundColor: Colors.bg2,
    borderWidth:     1,
    borderColor:     Colors.border,
    borderRadius:    Radius.lg,
    paddingVertical: Spacing.sm,
  },
  sheetTitle: {
    fontSize:      FontSizes.sm,
    fontWeight:    '700',
    color:         Colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.md,
    paddingTop:        Spacing.sm,
    paddingBottom:     Spacing.xs,
  },
  option: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingVertical:   Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  optionText:       { fontSize: FontSizes.md, color: Colors.text },
  optionTextActive: { color: Colors.accent, fontWeight: '700' },
});
