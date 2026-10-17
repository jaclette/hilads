import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
  Text, TextInput, TouchableOpacity, View, StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { track } from '@/services/analytics';
import {
  dailyErrorCode, editTwistProposal, fetchTwistProposal, proposeTwist, withdrawTwistProposal,
} from '@/api/daily';
import { formatCountdown, useCountdown } from '@/hooks/useDaily';
import { OriginalToggle, useOriginal } from '@/features/daily/OriginalToggle';
import type { DailyTwistProposalScreen, DailyTwistProposalStatus } from '@/types';

/**
 * Propose tomorrow's Local Twist (locals of a live city). Shows tomorrow's
 * challenge, the time left to propose (until 12h before the drop), the form,
 * then my proposal with its status: in review, picked, not picked. Editable
 * and withdrawable while proposals are open and it was not picked.
 */
export default function DailyTwistScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account } = useApp();

  const [data, setData]       = useState<DailyTwistProposalScreen | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed]   = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText]       = useState('');
  const [sending, setSending] = useState(false);
  const left = useCountdown(data?.open ? data.closesAt : null, null);
  const [showOriginal, toggleOriginal] = useOriginal();

  useEffect(() => {
    if (!account) router.replace('/auth-gate?reason=daily_proof&returnTo=%2Fdaily%2Ftwist' as never);
  }, [account, router]);

  const load = useCallback(async () => {
    try {
      setData(await fetchTwistProposal());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { if (account) load(); }, [account, load]);

  // The window closes while the screen is open: refresh to show it.
  useEffect(() => { if (left === 0) load(); }, [left, load]);

  const showError = (err: unknown) => {
    const code = dailyErrorCode(err) ?? 'generic';
    Alert.alert(t(`twist.errors.${code}`, { city: data?.city ? localizeCityName(data.city.name) : '', defaultValue: t('errors.generic') }));
    if (code === 'closed' || code === 'not_editable') load();
  };

  const submit = async () => {
    if (!data || sending) return;
    const value = text.trim();
    if (!value) return;
    setSending(true);
    try {
      const proposal = data.proposal ? await editTwistProposal(value) : await proposeTwist(value);
      track('daily_twist_proposed', {
        challenge_date: data.date, city: data.city?.name ?? null, is_local: true, edit: !!data.proposal,
      });
      setData({ ...data, proposal });
      setEditing(false);
    } catch (err) {
      showError(err);
    } finally {
      setSending(false);
    }
  };

  const withdraw = () => {
    Alert.alert(t('twist.withdrawTitle'), t('twist.withdrawBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('twist.withdraw'), style: 'destructive',
        onPress: async () => {
          try {
            await withdrawTwistProposal();
            setData(d => d ? { ...d, proposal: null } : d);
            setText('');
          } catch (err) {
            showError(err);
          }
        },
      },
    ]);
  };

  const cityName = data?.city ? localizeCityName(data.city.name) : '';
  const proposal = data?.proposal ?? null;
  const canChange = !!data?.open && proposal?.status === 'pending';
  const showForm = !!data?.open && (!proposal || editing);
  const blocked = data?.reason && data.reason !== 'closed' ? data.reason : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('back')}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>🌱 {t('twist.title')}</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : failed || !data ? (
        <View style={styles.center}>
          <Text style={styles.muted}>{t('loadFailed')}</Text>
          <TouchableOpacity onPress={() => { setLoading(true); load(); }}><Text style={styles.link}>{t('retry')}</Text></TouchableOpacity>
        </View>
      ) : blocked ? (
        <View style={styles.center}>
          <Text style={styles.blockedTitle}>🌱 {t('twist.title')}</Text>
          <Text style={styles.blocked}>{t(`twist.reasons.${blocked}`, { city: cityName, defaultValue: t('errors.generic') })}</Text>
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <View style={styles.card}>
              <Text style={styles.kicker}>🔥 {t('twist.tomorrow')}</Text>
              <Text style={styles.challenge}>{showOriginal && data.challenge?.original ? data.challenge.original.text : data.challenge?.text}</Text>
              {!!data.challenge?.context && (
                <Text style={styles.context}>{showOriginal && data.challenge.original ? data.challenge.original.context : data.challenge.context}</Text>
              )}
              <OriginalToggle translated={!!data.challenge?.original} showingOriginal={showOriginal} onPress={toggleOriginal} />
            </View>

            <Text style={styles.intro}>{t('twist.intro', { city: cityName })}</Text>
            <Text style={[styles.deadline, !data.open && styles.deadlineClosed]}>
              {data.open && left !== null ? `⏱ ${t('twist.closesIn', { time: formatCountdown(left) })}` : t('twist.closed')}
            </Text>

            {proposal && !editing && (
              <View style={styles.mine}>
                <View style={styles.mineTop}>
                  <Text style={styles.mineTitle}>{t('twist.yours')}</Text>
                  <StatusChip status={proposal.status} />
                </View>
                <Text style={styles.mineText}>{proposal.text}</Text>
                <Text style={styles.muted}>{t(`twist.statusHint.${proposal.status}`, { city: cityName })}</Text>
                {canChange && (
                  <View style={styles.actions}>
                    <TouchableOpacity onPress={() => { setText(proposal.text); setEditing(true); }} accessibilityRole="button">
                      <Text style={styles.link}>{t('edit')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={withdraw} accessibilityRole="button">
                      <Text style={[styles.link, styles.danger]}>{t('twist.withdraw')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {showForm && (
              <>
                <Text style={styles.label}>{t('twist.label', { city: cityName })}</Text>
                <TextInput
                  style={styles.input}
                  value={text}
                  onChangeText={setText}
                  placeholder={t('twist.placeholder')}
                  placeholderTextColor={colors.muted}
                  maxLength={data.maxLength}
                  multiline
                  autoFocus={!proposal}
                />
                <Text style={[styles.counter, text.length > data.maxLength - 20 && styles.counterNear]}>
                  {text.length}/{data.maxLength}
                </Text>
                <Text style={styles.muted}>{t('twist.hint')}</Text>
              </>
            )}
          </ScrollView>

          {showForm && (
            <View style={styles.footer}>
              {editing && (
                <TouchableOpacity onPress={() => setEditing(false)} style={styles.cancel} accessibilityRole="button">
                  <Text style={styles.link}>{t('cancel')}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.submit, (!text.trim() || sending) && styles.submitOff]}
                onPress={submit}
                disabled={!text.trim() || sending}
                accessibilityRole="button"
              >
                {sending ? <ActivityIndicator color={colors.white} /> : (
                  <Text style={styles.submitText}>{proposal ? t('proof.save') : t('twist.submit')}</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function StatusChip({ status }: { status: DailyTwistProposalStatus }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  return (
    <View style={[styles.chip, status === 'picked' && styles.chipPicked, status === 'not_picked' && styles.chipOff]}>
      <Text style={[styles.chipText, status === 'picked' && styles.chipTextPicked]}>{t(`twist.status.${status}`)}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:     { flex: 1, backgroundColor: c.bg },
  flex:          { flex: 1 },
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: Spacing.md },
  nav:           { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  back:          { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: c.bg2, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  navTitle:      { flex: 1, fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  body:          { padding: Spacing.md, gap: 10, paddingBottom: 30 },
  card:          { backgroundColor: c.bg2, borderRadius: Radius.lg, borderWidth: 1, borderColor: 'rgba(255,122,60,0.45)', padding: 16, gap: 6 },
  kicker:        { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: c.accentText },
  challenge:     { fontSize: FontSizes.lg, fontWeight: '800', color: c.text, lineHeight: 26 },
  context:       { fontSize: FontSizes.sm, color: c.muted, lineHeight: 20 },
  intro:         { fontSize: FontSizes.sm, color: c.text, lineHeight: 20 },
  deadline:      { fontSize: 12, fontWeight: '700', color: c.accentText },
  deadlineClosed:{ color: c.muted },
  mine:          { backgroundColor: c.bg2, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.border, padding: 14, gap: 8 },
  mineTop:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  mineTitle:     { fontSize: FontSizes.sm, fontWeight: '800', color: c.text },
  mineText:      { fontSize: FontSizes.md, color: c.text, lineHeight: 22 },
  actions:       { flexDirection: 'row', gap: 18, marginTop: 2 },
  label:         { fontSize: FontSizes.xs, fontWeight: '800', color: c.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 6 },
  input:         { minHeight: 110, textAlignVertical: 'top', backgroundColor: c.bg2, borderWidth: 1, borderColor: c.border, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 12, fontSize: FontSizes.sm, color: c.text },
  counter:       { alignSelf: 'flex-end', fontSize: 12, color: c.muted },
  counterNear:   { color: c.accentText, fontWeight: '700' },
  muted:         { fontSize: 12, color: c.muted, lineHeight: 18 },
  link:          { fontSize: FontSizes.sm, fontWeight: '700', color: c.accentText },
  danger:        { color: c.red },
  blockedTitle:  { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  blocked:       { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center', lineHeight: 20 },
  chip:          { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full, backgroundColor: c.bg3 },
  chipPicked:    { backgroundColor: c.accent },
  chipOff:       { opacity: 0.7 },
  chipText:      { fontSize: 12, fontWeight: '800', color: c.text },
  chipTextPicked:{ color: c.white },
  footer:        { flexDirection: 'row', alignItems: 'center', gap: 16, padding: Spacing.md, borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.bg },
  cancel:        { paddingHorizontal: 4 },
  submit:        { flex: 1, backgroundColor: c.accent, borderRadius: Radius.full, paddingVertical: 15, alignItems: 'center' },
  submitOff:     { opacity: 0.5 },
  submitText:    { color: c.white, fontSize: FontSizes.md, fontWeight: '800' },
});
