import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
  Text, TouchableOpacity, View, StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Border, FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { Button, Card, EmptyState, Screen, ScreenHeader, TextField } from '@/ui';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { localizeCityName, shortCityName } from '@/i18n/cityName';
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

  const cityName = data?.city ? shortCityName(data.city.name) : '';
  const proposal = data?.proposal ?? null;
  const canChange = !!data?.open && proposal?.status === 'pending';
  const showForm = !!data?.open && (!proposal || editing);
  const blocked = data?.reason && data.reason !== 'closed' ? data.reason : null;

  return (
    <Screen>
      <ScreenHeader title={t('twist.title')} />

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : failed || !data ? (
        <View style={styles.center}>
          <EmptyState icon="cloud-offline-outline" body={t('loadFailed')}
                      action={<Button variant="secondary" size="sm" label={t('retry')} onPress={() => { setLoading(true); load(); }} />} />
        </View>
      ) : blocked ? (
        <View style={styles.center}>
          <EmptyState icon="leaf-outline" title={t('twist.title')}
                      body={t(`twist.reasons.${blocked}`, { city: cityName, defaultValue: t('errors.generic') })} />
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Card variant="ticket" style={styles.card}>
              <View style={styles.iconRow}>
                <Ionicons name="flame" size={14} color={colors.primaryText} />
                <Text style={styles.kicker}>{t('twist.tomorrow')}</Text>
              </View>
              <Text style={styles.challenge}>{showOriginal && data.challenge?.original ? data.challenge.original.text : data.challenge?.text}</Text>
              {!!data.challenge?.context && (
                <Text style={styles.context}>{showOriginal && data.challenge.original ? data.challenge.original.context : data.challenge.context}</Text>
              )}
              <OriginalToggle translated={!!data.challenge?.original} showingOriginal={showOriginal} onPress={toggleOriginal} />
            </Card>

            <Text style={styles.intro}>{t('twist.intro', { city: cityName })}</Text>
            <View style={styles.iconRow}>
              <Ionicons name="time-outline" size={14} color={data.open ? colors.primaryText : colors.muted} />
              <Text style={[styles.deadline, !data.open && styles.deadlineClosed]}>
                {data.open && left !== null ? t('twist.closesIn', { time: formatCountdown(left) }) : t('twist.closed')}
              </Text>
            </View>

            {proposal && !editing && (
              <Card style={styles.mine}>
                <View style={styles.mineTop}>
                  <Text style={styles.mineTitle}>{t('twist.yours')}</Text>
                  <StatusChip status={proposal.status} />
                </View>
                <Text style={styles.mineText}>{proposal.text}</Text>
                <Text style={styles.muted}>{t(`twist.statusHint.${proposal.status}`, { city: cityName })}</Text>
                {canChange && (
                  <View style={styles.actions}>
                    <Button variant="link" label={t('edit')} onPress={() => { setText(proposal.text); setEditing(true); }} />
                    <TouchableOpacity onPress={withdraw} style={styles.dangerBtn} accessibilityRole="button">
                      <Text style={styles.danger}>{t('twist.withdraw')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </Card>
            )}

            {showForm && (
              <>
                <TextField
                  label={t('twist.label', { city: cityName })}
                  value={text}
                  onChangeText={setText}
                  placeholder={t('twist.placeholder')}
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
              {editing && <Button variant="link" label={t('cancel')} onPress={() => setEditing(false)} />}
              <Button
                label={proposal ? t('proof.save') : t('twist.submit')}
                onPress={submit}
                disabled={!text.trim()}
                loading={sending}
                style={styles.submit}
              />
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </Screen>
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
  flex:          { flex: 1 },
  center:        { flex: 1, justifyContent: 'center', padding: Spacing.md },
  body:          { padding: Spacing.md, paddingTop: Spacing.sm, gap: 12, paddingBottom: 30 },
  card:          { padding: 16, gap: 8 },
  iconRow:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kicker:        { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: c.primaryText },
  challenge:     { fontSize: FontSizes.lg, fontWeight: '800', color: c.text, lineHeight: 26 },
  context:       { fontSize: FontSizes.sm, fontWeight: '400', color: c.muted, lineHeight: 20 },
  intro:         { fontSize: FontSizes.sm, fontWeight: '500', color: c.text, lineHeight: 20 },
  deadline:      { fontSize: 12, fontWeight: '700', color: c.primaryText },
  deadlineClosed:{ color: c.muted },
  mine:          { padding: 14, gap: 8 },
  mineTop:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  mineTitle:     { fontSize: 15, fontWeight: '800', color: c.text },
  mineText:      { fontSize: FontSizes.md, fontWeight: '500', color: c.text, lineHeight: 22 },
  actions:       { flexDirection: 'row', alignItems: 'center', gap: 20 },
  dangerBtn:     { minHeight: 44, justifyContent: 'center' },
  danger:        { fontSize: FontSizes.sm, fontWeight: '700', color: c.red },
  counter:       { alignSelf: 'flex-end', fontSize: 12, fontWeight: '600', color: c.muted },
  counterNear:   { color: c.primaryText, fontWeight: '700' },
  muted:         { fontSize: 12, fontWeight: '500', color: c.muted, lineHeight: 18 },
  chip:          { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full, backgroundColor: c.primaryTint },
  chipPicked:    { backgroundColor: c.primary },
  chipOff:       { backgroundColor: c.bg3 },
  chipText:      { fontSize: 12, fontWeight: '800', color: c.primaryOnTint },
  chipTextPicked:{ color: c.white },
  footer:        { flexDirection: 'row', alignItems: 'center', gap: 16, padding: Spacing.md, borderTopWidth: Border, borderTopColor: c.line, backgroundColor: c.bg },
  submit:        { flex: 1 },
});
