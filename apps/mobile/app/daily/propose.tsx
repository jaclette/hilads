import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { track } from '@/services/analytics';
import { dailyErrorCode, proposeChallenge } from '@/api/daily';
import { useDailyToday } from '@/hooks/useDaily';
import { THEME_EMOJI, THEME_KEYS, THEME_NAMES } from '@/features/daily/themes';
import type { DailyThemeKey } from '@/types';

const TEXT_MAX  = 120;
const WHY_MAX   = 200;
const TWIST_MAX = 280;

/**
 * Propose a Daily Challenge (V2-06): English text (120), a theme, a short why
 * and, for a local of a live city, an optional Local Twist for it. The
 * editorial rules show as a checklist; every proposal is reviewed. ?source=
 * is the entry point (tracking).
 */
export default function DailyProposeScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { source } = useLocalSearchParams<{ source?: string }>();
  const { account, city } = useApp();
  const today = useDailyToday(city?.channelId);

  const [text, setText]   = useState('');
  const [theme, setTheme] = useState<DailyThemeKey | null>(null);
  const [why, setWhy]     = useState('');
  const [twist, setTwist] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent]   = useState(false);

  // The server checks it again (home city must match).
  const canTwist = account?.mode === 'local' && !!today.data?.city?.isLive;
  const cityName = today.data?.city?.name ? localizeCityName(today.data.city.name) : '';

  const tracked = useRef(false);
  useEffect(() => {
    if (!account) { router.replace('/auth-gate?reason=create_challenge&returnTo=%2Fdaily%2Fpropose' as never); return; }
    if (tracked.current) return;
    tracked.current = true;
    track('daily_proposal_started', { entry: source ?? 'unknown', type: 'challenge', city: city?.name ?? null });
  }, [account, router, source, city?.name]);

  const length = [...text.trim()].length;
  const canSend = length > 0 && length <= TEXT_MAX && theme !== null && !sending;

  const submit = async () => {
    if (!canSend || !theme) return;
    setSending(true);
    setError(null);
    try {
      await proposeChallenge({
        text: text.trim(), theme,
        why: why.trim() || undefined,
        twistText: canTwist && twist.trim() ? twist.trim() : undefined,
      });
      track('daily_proposal_submitted', {
        theme, has_why: !!why.trim(), has_twist: canTwist && !!twist.trim(), city: city?.name ?? null, entry: source ?? 'unknown',
      });
      setSent(true);
    } catch (err) {
      const code = dailyErrorCode(err) ?? 'generic';
      setError(code === 'pending_exists' ? 'pending_exists' : t(`propose.errors.${code}`, { defaultValue: t('errors.generic') }));
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <Text style={styles.sentEmoji}>💡</Text>
        <Text style={styles.sentTitle}>{t('propose.sentTitle')}</Text>
        <Text style={styles.sentBody}>{t('propose.sentBody')}</Text>
        <TouchableOpacity style={styles.cta} onPress={() => router.replace('/daily/proposals' as never)} accessibilityRole="button">
          <Text style={styles.ctaText}>{t('propose.seeMine')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('back')}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>💡 {t('propose.title')}</Text>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>{t('propose.textLabel')}</Text>
          <TextInput
            style={[styles.input, styles.inputTall]}
            value={text}
            onChangeText={setText}
            placeholder={t('propose.textPlaceholder')}
            placeholderTextColor={colors.mutedDim}
            multiline
            maxLength={TEXT_MAX + 20}
            autoCapitalize="sentences"
          />
          <Text style={[styles.counter, length > TEXT_MAX && styles.counterOver, length > 100 && length <= TEXT_MAX && styles.counterNear]}>
            {length} / {TEXT_MAX}
          </Text>

          <Text style={styles.label}>{t('propose.themeLabel')}</Text>
          <View style={styles.themes}>
            {THEME_KEYS.map(k => (
              <TouchableOpacity
                key={k}
                style={[styles.chip, theme === k && styles.chipOn]}
                onPress={() => setTheme(k)}
                accessibilityRole="button"
                accessibilityState={{ selected: theme === k }}
              >
                <Text style={[styles.chipText, theme === k && styles.chipTextOn]}>{THEME_EMOJI[k]} {THEME_NAMES[k]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>{t('propose.whyLabel')}</Text>
          <TextInput
            style={styles.input}
            value={why}
            onChangeText={setWhy}
            placeholder={t('propose.whyPlaceholder')}
            placeholderTextColor={colors.mutedDim}
            multiline
            maxLength={WHY_MAX}
          />

          {canTwist && (
            <>
              <Text style={styles.label}>📍 {t('propose.twistLabel', { city: cityName })}</Text>
              <TextInput
                style={styles.input}
                value={twist}
                onChangeText={setTwist}
                placeholder={t('propose.twistPlaceholder', { city: cityName })}
                placeholderTextColor={colors.mutedDim}
                multiline
                maxLength={TWIST_MAX}
              />
            </>
          )}

          <View style={styles.rules}>
            <Text style={styles.rulesTitle}>{t('propose.rulesTitle')}</Text>
            {[1, 2, 3, 4, 5].map(i => (
              <Text key={i} style={styles.rule}>✓ {t(`propose.rule${i}`)}</Text>
            ))}
            <Text style={styles.reviewed}>{t('propose.reviewed')}</Text>
          </View>

          {error === 'pending_exists' ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{t('propose.pendingExists')}</Text>
              <TouchableOpacity onPress={() => router.replace('/daily/proposals' as never)} accessibilityRole="button">
                <Text style={styles.link}>{t('propose.seeMine')} ›</Text>
              </TouchableOpacity>
            </View>
          ) : error ? (
            <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>
          ) : null}

          <TouchableOpacity
            style={[styles.cta, !canSend && styles.ctaOff]}
            onPress={submit}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend, busy: sending }}
          >
            <Text style={styles.ctaText}>{sending ? '…' : t('propose.submit')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:   { flex: 1, backgroundColor: c.bg },
  flex:        { flex: 1 },
  center:      { alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, gap: 12 },
  nav:         { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  back:        { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: c.bg2, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  navTitle:    { flex: 1, fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  body:        { padding: Spacing.md, gap: 8, paddingBottom: 48 },
  label:       { fontSize: FontSizes.sm, fontWeight: '800', color: c.text, marginTop: 8 },
  input:       { backgroundColor: c.inputBg, borderRadius: Radius.md, borderWidth: 1, borderColor: c.border, color: c.text, fontSize: FontSizes.sm, paddingHorizontal: 12, paddingVertical: 10, minHeight: 48, textAlignVertical: 'top' },
  inputTall:   { minHeight: 84, fontSize: FontSizes.md, fontWeight: '700' },
  counter:     { alignSelf: 'flex-end', fontSize: 12, color: c.muted, fontWeight: '700' },
  counterNear: { color: c.warning },
  counterOver: { color: c.red },
  themes:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:        { paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg2 },
  chipOn:      { backgroundColor: c.accent, borderColor: c.accent },
  chipText:    { fontSize: FontSizes.xs, fontWeight: '700', color: c.text },
  chipTextOn:  { color: c.white },
  rules:       { backgroundColor: c.bg2, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.border, padding: 12, gap: 4, marginTop: 12 },
  rulesTitle:  { fontSize: FontSizes.sm, fontWeight: '800', color: c.text, marginBottom: 2 },
  rule:        { fontSize: FontSizes.xs, color: c.text },
  reviewed:    { fontSize: 12, color: c.muted, marginTop: 6 },
  errorBox:    { backgroundColor: c.bg2, borderRadius: Radius.md, borderWidth: 1, borderColor: c.red, padding: 10, gap: 6 },
  errorText:   { fontSize: FontSizes.xs, color: c.red, fontWeight: '600' },
  link:        { fontSize: FontSizes.sm, fontWeight: '800', color: c.accentText },
  cta:         { backgroundColor: c.accent, borderRadius: Radius.full, paddingVertical: 14, paddingHorizontal: 24, alignItems: 'center', marginTop: 12 },
  ctaOff:      { opacity: 0.45 },
  ctaText:     { color: c.white, fontSize: FontSizes.md, fontWeight: '800' },
  sentEmoji:   { fontSize: 48 },
  sentTitle:   { fontSize: FontSizes.lg, fontWeight: '900', color: c.text },
  sentBody:    { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center' },
});
