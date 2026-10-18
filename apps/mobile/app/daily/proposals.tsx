import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { Button, Card, Chip, EmptyState, Screen, ScreenHeader } from '@/ui';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { shortCityName } from '@/i18n/cityName';
import { fetchMyProposals, withdrawProposal } from '@/api/daily';
import type { DailyProposal } from '@/types';
import { themeName } from '@/features/daily/themes';

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
    if (!account) { router.replace('/auth-gate?reason=create_challenge&returnTo=%2Fdaily%2Fproposals' as never); return; }
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
    <Screen>
      <ScreenHeader title={t('propose.mineTitle')} />

      {failed && !items ? (
        <View style={styles.center}>
          <EmptyState icon="cloud-offline-outline" body={t('loadFailed')}
                      action={<Button variant="secondary" size="sm" label={t('retry')} onPress={load} />} />
        </View>
      ) : !items ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={p => `${p.type}:${p.id}`}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Button icon="bulb-outline" label={t('propose.cta')} onPress={propose} style={styles.cta} />
          }
          ListEmptyComponent={<EmptyState icon="bulb-outline" body={t('propose.empty')} />}
          renderItem={({ item }) => <ProposalRow item={item} onWithdraw={() => withdraw(item)} />}
        />
      )}
    </Screen>
  );
}

function ProposalRow({ item, onWithdraw }: { item: DailyProposal; onWithdraw: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
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
      onPress={canOpen ? () => router.push(`/daily/${item.date}` as never) : undefined}
      disabled={!canOpen}
      activeOpacity={0.85}
      accessibilityRole={canOpen ? 'button' : undefined}
    >
      <Card style={styles.card}>
        <View style={styles.cardHead}>
          <View style={styles.iconRow}>
            <Ionicons name={item.type === 'twist' ? 'location-outline' : 'bulb-outline'} size={14} color={colors.muted} />
            <Text style={styles.type}>{item.type === 'twist' ? t('propose.typeTwist') : t('propose.typeChallenge')}</Text>
          </View>
          <Text style={[styles.status, tone === 'ok' && styles.statusOk, tone === 'wait' && styles.statusWait, tone === 'off' && styles.statusOff]}>
            {t(`propose.status.${item.status}`, { date })}
          </Text>
        </View>
        <Text style={styles.text}>{item.text}</Text>
        {(item.theme || item.city) && (
          <View style={styles.iconRow}>
            {item.theme && <Chip theme={item.theme.key} label={themeName(item.theme.key)} />}
            {item.city && <Text style={styles.meta} numberOfLines={1}>{shortCityName(item.city.name ?? '')}</Text>}
          </View>
        )}
        {!!item.twistText && (
          <View style={styles.iconRow}>
            <Ionicons name="location-outline" size={14} color={colors.primaryText} />
            <Text style={styles.twist}>{item.twistText}</Text>
          </View>
        )}
        {!!item.rejectionReason && <Text style={styles.reason}>{t('propose.reason', { reason: item.rejectionReason })}</Text>}
        {item.type === 'challenge' && item.status === 'pending' && (
          <TouchableOpacity onPress={onWithdraw} accessibilityRole="button" style={styles.withdraw}>
            <Text style={styles.withdrawText}>{t('propose.withdraw')}</Text>
          </TouchableOpacity>
        )}
      </Card>
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  center:      { flex: 1, justifyContent: 'center', padding: Spacing.md },
  list:        { padding: Spacing.md, paddingTop: Spacing.sm, gap: 10, paddingBottom: 40 },
  cta:         { marginBottom: 4 },
  card:        { padding: 14, gap: 8 },
  cardHead:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  iconRow:     { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  type:        { fontSize: 12, fontWeight: '800', color: c.muted, textTransform: 'uppercase', letterSpacing: 0.4 },
  status:      { fontSize: 12, fontWeight: '800', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden' },
  statusOk:    { color: c.localText, backgroundColor: c.localBg },
  statusWait:  { color: c.primaryOnTint, backgroundColor: c.primaryTint },
  statusOff:   { color: c.muted, backgroundColor: c.bg3 },
  text:        { fontSize: FontSizes.md, fontWeight: '800', color: c.text },
  meta:        { flexShrink: 1, fontSize: 12, fontWeight: '500', color: c.muted },
  twist:       { flex: 1, fontSize: FontSizes.xs, fontWeight: '600', color: c.primaryText },
  reason:      { fontSize: FontSizes.xs, color: c.red, fontWeight: '600' },
  withdraw:    { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  withdrawText:{ fontSize: FontSizes.sm, fontWeight: '800', color: c.red },
});
