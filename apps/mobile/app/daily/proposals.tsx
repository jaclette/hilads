import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { fetchMyProposals, withdrawProposal } from '@/api/daily';
import { themeLabel } from '@/features/daily/themes';
import type { DailyProposal } from '@/types';

/**
 * My proposals (V2-06, from MY PROFILE and the "approved" push): my challenge
 * proposals and my Local Twist proposals with their status (in review,
 * scheduled with its date, live, in the reserve, rejected with the reason;
 * picked / not picked for twists). A challenge proposal in review can be
 * withdrawn.
 */
export default function DailyProposalsScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account } = useApp();
  const [items, setItems] = useState<DailyProposal[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!account) { router.replace('/auth-gate?reason=create_challenge' as never); return; }
    try {
      setItems((await fetchMyProposals()).items);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [account, router]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const propose = () => {
    router.push('/daily/propose?source=my_proposals' as never);
  };

  const withdraw = (p: DailyProposal) => {
    Alert.alert(t('propose.withdrawTitle'), t('propose.withdrawBody'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('propose.withdraw'), style: 'destructive',
        onPress: async () => {
          try {
            await withdrawProposal(p.id);
            load();
          } catch {
            Alert.alert(t('errors.generic'));
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.nav}>
        <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('back')}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>💡 {t('propose.mineTitle')}</Text>
      </View>

      {failed && !items ? (
        <View style={styles.center}>
          <Text style={styles.muted}>{t('loadFailed')}</Text>
          <TouchableOpacity onPress={load}><Text style={styles.link}>{t('retry')}</Text></TouchableOpacity>
        </View>
      ) : !items ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={p => `${p.type}:${p.id}`}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <TouchableOpacity style={styles.cta} onPress={propose} accessibilityRole="button">
              <Text style={styles.ctaText}>💡 {t('propose.cta')}</Text>
            </TouchableOpacity>
          }
          ListEmptyComponent={<Text style={styles.empty}>{t('propose.empty')}</Text>}
          renderItem={({ item }) => <ProposalRow item={item} onWithdraw={() => withdraw(item)} />}
        />
      )}
    </SafeAreaView>
  );
}

function ProposalRow({ item, onWithdraw }: { item: DailyProposal; onWithdraw: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  const date = item.date
    ? new Date(`${item.date}T12:00:00Z`).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    : '';
  const tone = item.status === 'rejected' || item.status === 'not_picked' ? 'off'
    : item.status === 'pending' ? 'wait' : 'ok';
  const canOpen = !!item.date && (item.status === 'published' || item.status === 'picked');
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={canOpen ? () => router.push(`/daily/${item.date}` as never) : undefined}
      disabled={!canOpen}
      activeOpacity={0.85}
      accessibilityRole={canOpen ? 'button' : undefined}
    >
      <View style={styles.cardHead}>
        <Text style={styles.type}>{item.type === 'twist' ? `📍 ${t('propose.typeTwist')}` : `💡 ${t('propose.typeChallenge')}`}</Text>
        <Text style={[styles.status, tone === 'ok' && styles.statusOk, tone === 'wait' && styles.statusWait, tone === 'off' && styles.statusOff]}>
          {t(`propose.status.${item.status}`, { date })}
        </Text>
      </View>
      <Text style={styles.text}>{item.text}</Text>
      <Text style={styles.meta} numberOfLines={1}>
        {[themeLabel(item.theme), item.city ? localizeCityName(item.city.name ?? '') : ''].filter(Boolean).join(' · ')}
      </Text>
      {!!item.twistText && <Text style={styles.twist}>📍 {item.twistText}</Text>}
      {!!item.rejectionReason && <Text style={styles.reason}>{t('propose.reason', { reason: item.rejectionReason })}</Text>}
      {item.type === 'challenge' && item.status === 'pending' && (
        <TouchableOpacity onPress={onWithdraw} hitSlop={8} accessibilityRole="button" style={styles.withdraw}>
          <Text style={styles.withdrawText}>{t('propose.withdraw')}</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container:   { flex: 1, backgroundColor: c.bg },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: Spacing.md },
  nav:         { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.md, paddingVertical: 10 },
  back:        { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: c.bg2, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  navTitle:    { flex: 1, fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  list:        { padding: Spacing.md, gap: 10, paddingBottom: 40 },
  cta:         { backgroundColor: c.accent, borderRadius: Radius.full, paddingVertical: 13, alignItems: 'center', marginBottom: 4 },
  ctaText:     { color: c.white, fontSize: FontSizes.md, fontWeight: '800' },
  empty:       { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center', paddingVertical: 24 },
  muted:       { fontSize: FontSizes.sm, color: c.muted },
  link:        { fontSize: FontSizes.sm, fontWeight: '800', color: c.accentText },
  card:        { backgroundColor: c.bg2, borderRadius: Radius.lg, borderWidth: 1, borderColor: c.border, padding: 12, gap: 6 },
  cardHead:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  type:        { fontSize: 12, fontWeight: '800', color: c.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  status:      { fontSize: 12, fontWeight: '800', borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 3, overflow: 'hidden' },
  statusOk:    { color: c.green, backgroundColor: c.bg3 },
  statusWait:  { color: c.warning, backgroundColor: c.bg3 },
  statusOff:   { color: c.muted, backgroundColor: c.bg3 },
  text:        { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  meta:        { fontSize: 12, color: c.muted },
  twist:       { fontSize: FontSizes.xs, color: c.accentText },
  reason:      { fontSize: FontSizes.xs, color: c.red, fontWeight: '600' },
  withdraw:    { alignSelf: 'flex-start', marginTop: 2 },
  withdrawText:{ fontSize: FontSizes.xs, fontWeight: '800', color: c.red },
});
