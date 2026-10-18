import { useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Button, CityFlag } from '@/ui';
import { fetchUserDaily } from '@/api/daily';
import { DailyProofViewer } from './DailyProofViewer';
import { RankMedal } from './RankMedal';
import { shortCityName } from '@/i18n/cityName';
import type { DailyProof, DailyUserStats } from '@/types';

/**
 * Daily Challenge stats on a profile (Challenges tab): current streak, best
 * streak, challenges completed, best proofs, Local Passes earned (and, on
 * mine, my progress toward the next ones). Hidden on someone else's profile
 * until they completed one; on mine it nudges to start.
 */
export function DailyProfileStats({ userId, isMe }: { userId: string; isMe: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const [stats, setStats] = useState<DailyUserStats | null>(null);
  const [viewing, setViewing] = useState<DailyProof | null>(null);

  useEffect(() => {
    let alive = true;
    fetchUserDaily(userId)
      .then(s => { if (alive) setStats(s); })
      .catch(err => console.warn('[daily] profile stats failed:', String(err)));
    return () => { alive = false; };
  }, [userId]);

  if (!stats || (stats.completed === 0 && !isMe)) return null;
  const inProgress = (stats.localPassProgress ?? []).filter(p => !p.earned).slice(0, 3);

  return (
    <View style={styles.card}>
      <View style={styles.kickerRow}>
        <Ionicons name="flame-outline" size={16} color={colors.primaryText} />
        <Text style={styles.kicker}>{t('kicker')}</Text>
      </View>
      {stats.completed === 0 ? (
        <>
          <Text style={styles.empty}>{t('profile.emptyMine')}</Text>
          <Button size="sm" label={t('cta')} onPress={() => router.push('/daily/today' as never)} style={styles.cta} />
        </>
      ) : (
        <>
          <View style={styles.statsRow}>
            <Stat value={stats.currentStreak} label={t('profile.streak', { count: stats.currentStreak })} />
            <Stat value={stats.bestStreak} label={t('profile.bestStreak')} />
            <Stat value={stats.completed} label={t('profile.completed', { count: stats.completed })} />
          </View>
          {((stats.localPasses?.length ?? 0) > 0 || (isMe && inProgress.length > 0)) && (
            <>
              <View style={styles.kickerRow}>
                <Ionicons name="ribbon-outline" size={15} color={colors.gold} />
                <Text style={styles.subTitle}>{t('localPass.profileTitle')}</Text>
              </View>
              <View style={styles.passes}>
                {stats.localPasses?.map(p => (
                  <View key={`p${p.city.id}`} style={[styles.pass, styles.passEarned]}>
                    <Ionicons name="checkmark-circle" size={14} color={colors.gold} />
                    <CityFlag country={p.city.country} size={14} />
                    <Text style={[styles.passText, styles.passTextEarned]}>{shortCityName(p.city.name ?? '')} · {t('localPass.earned')}</Text>
                  </View>
                ))}
                {isMe && inProgress.map(p => (
                  <View key={`g${p.city.id}`} style={styles.pass}>
                    <CityFlag country={p.city.country} size={14} />
                    <Text style={styles.passText}>{shortCityName(p.city.name ?? '')} · {t('localPass.progress', { done: p.done, total: p.total })}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
          {stats.bestProofs.length > 0 && (
            <>
              <Text style={styles.subTitle}>{t('profile.bestProofs')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbs}>
                {stats.bestProofs.map(p => (
                  <TouchableOpacity key={p.id} onPress={() => setViewing(p)} accessibilityRole="button" accessibilityLabel={p.caption ?? t('kicker')}>
                    <Image source={{ uri: p.thumbUrl ?? p.photoUrl }} style={styles.thumb} contentFit="cover" />
                    {p.worldRank !== null && p.worldRank <= 3 && <RankMedal rank={p.worldRank} size={22} style={styles.medal} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}
        </>
      )}
      <DailyProofViewer proof={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>{label}</Text>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  card:      { backgroundColor: c.bg2, borderRadius: Radius.ticket, borderWidth: Border, borderColor: c.ticketLine, padding: 14, gap: 10 },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kicker:    { fontSize: FontSizes.sm, fontWeight: '700', color: c.primaryText },
  empty:     { fontSize: FontSizes.sm, fontWeight: '400', color: c.muted },
  cta:       { alignSelf: 'flex-start' },
  statsRow:  { flexDirection: 'row', gap: 8 },
  stat:      { flex: 1, backgroundColor: c.bg3, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center', gap: 2 },
  statValue: { fontSize: FontSizes.lg, fontWeight: '800', color: c.text },
  statLabel: { fontSize: 12, fontWeight: '600', color: c.muted, textAlign: 'center' },
  subTitle:  { fontSize: FontSizes.xs, fontWeight: '800', color: c.text },
  thumbs:    { gap: 8 },
  thumb:     { width: 72, height: 72, borderRadius: 12, backgroundColor: c.bg3 },
  medal:     { position: 'absolute', top: 4, left: 4 },
  passes:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pass:      { flexDirection: 'row', alignItems: 'center', gap: 4, height: 28, borderRadius: Radius.full, borderWidth: Border, borderColor: c.line,
               backgroundColor: c.bg2, paddingHorizontal: 10 },
  passEarned:    { borderColor: c.gold },
  passText:      { fontSize: 12, fontWeight: '700', color: c.text },
  passTextEarned:{ color: c.gold },
});
