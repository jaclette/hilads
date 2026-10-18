import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { Button, Card, Chip, EmptyState, Screen, ScreenHeader, TextField } from '@/ui';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { shortCityName } from '@/i18n/cityName';
import { track } from '@/services/analytics';
import { dailyErrorCode, proposeChallenge } from '@/api/daily';
import { useDailyToday } from '@/hooks/useDaily';
import { THEME_KEYS, themeName } from '@/features/daily/themes';
import { THEME_ICON } from '@/features/today/format';
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
  const cityName = today.data?.city?.name ? shortCityName(today.data.city.name) : '';

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
      <Screen>
        <View style={styles.center}>
          <EmptyState
            icon="bulb-outline"
            title={t('propose.sentTitle')}
            body={t('propose.sentBody')}
            action={<Button label={t('propose.seeMine')} onPress={() => router.replace('/daily/proposals' as never)} style={styles.stretch} />}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title={t('propose.title')} />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <TextField
            label={t('propose.textLabel')}
            value={text}
            onChangeText={setText}
            placeholder={t('propose.textPlaceholder')}
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
              <Chip key={k} variant="filter" label={themeName(k)} selected={theme === k} onPress={() => setTheme(k)} />
            ))}
          </View>

          <TextField
            label={t('propose.whyLabel')}
            value={why}
            onChangeText={setWhy}
            placeholder={t('propose.whyPlaceholder')}
            multiline
            maxLength={WHY_MAX}
          />

          {canTwist && (
            <>
              <TextField
                label={t('propose.twistLabel', { city: cityName })}
                value={twist}
                onChangeText={setTwist}
                placeholder={t('propose.twistPlaceholder', { city: cityName })}
                multiline
                maxLength={TWIST_MAX}
              />
            </>
          )}

          <Card style={styles.rules}>
            <Text style={styles.rulesTitle}>{t('propose.rulesTitle')}</Text>
            {[1, 2, 3, 4, 5].map(i => (
              <View key={i} style={styles.ruleRow}>
                <Ionicons name="checkmark" size={16} color={colors.localText} />
                <Text style={styles.rule}>{t(`propose.rule${i}`)}</Text>
              </View>
            ))}
            <Text style={styles.reviewed}>{t('propose.reviewed')}</Text>
          </Card>

          {error === 'pending_exists' ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{t('propose.pendingExists')}</Text>
              <Button variant="link" label={t('propose.seeMine')} onPress={() => router.replace('/daily/proposals' as never)} style={styles.linkBtn} />
            </View>
          ) : error ? (
            <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>
          ) : null}

          <Button label={t('propose.submit')} onPress={submit} disabled={!canSend && !sending} loading={sending} style={styles.cta} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  flex:        { flex: 1 },
  center:      { flex: 1, justifyContent: 'center', padding: Spacing.lg },
  stretch:     { alignSelf: 'stretch', marginTop: Spacing.sm },
  body:        { padding: Spacing.md, paddingTop: Spacing.sm, gap: 10, paddingBottom: 48 },
  label:       { fontSize: FontSizes.xs, fontWeight: '700', color: c.muted, marginTop: 4 },
  counter:     { alignSelf: 'flex-end', fontSize: 12, color: c.muted, fontWeight: '700' },
  counterNear: { color: c.warning },
  counterOver: { color: c.red },
  themes:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rules:       { padding: 14, gap: 6, marginTop: 8 },
  rulesTitle:  { fontSize: 15, fontWeight: '800', color: c.text, marginBottom: 2 },
  ruleRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  rule:        { flex: 1, fontSize: FontSizes.xs, fontWeight: '500', color: c.text },
  reviewed:    { fontSize: 12, fontWeight: '500', color: c.muted, marginTop: 4 },
  errorBox:    { borderRadius: Radius.button, borderWidth: 1.5, borderColor: c.red, padding: 12, gap: 4 },
  errorText:   { fontSize: FontSizes.xs, color: c.red, fontWeight: '600' },
  linkBtn:     { alignSelf: 'flex-start' },
  cta:         { marginTop: 8 },
});
