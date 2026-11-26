import { useCallback, useEffect, useState } from 'react';
import { AppState, Modal, Text, View, StyleSheet } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Haptics from 'expo-haptics';
import { Space, Radius, Type, type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { Avatar, Button } from '@/ui';
import { Confetti } from '@/ui/joy';
import { RankMedal } from '@/features/daily/RankMedal';
import { useCelebrationTurn } from '@/lib/celebrationQueue';
import { track } from '@/services/analytics';
import { fetchSeasonResult, markSeasonSeen, seasonName, type SeasonResult } from './points';
import i18n from '@/i18n';
import { ordinal } from '@/lib/ordinal';

/**
 * The season's results (scoring v2): once a month, after the drop of the 1st froze the
 * season, a celebratory screen with my final rank (a medal for the top 3), the season's
 * podium and "a new season starts now". Shown once (POST /me/season-result/seen), through
 * the celebration queue like every victory popup. Mounted in the root layout.
 */
export function SeasonResultGate() {
  const { account } = useApp();
  const router = useRouter();
  const segments = useSegments();
  const [result, setResult] = useState<SeasonResult | null>(null);

  const load = useCallback(() => {
    if (!account?.id) return;
    fetchSeasonResult().then(r => { if (r) setResult(r); });
  }, [account?.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') load(); });
    return () => sub.remove();
  }, [load]);

  const turn = useCelebrationTurn('season_result', result !== null, segments[0] === '(tabs)');
  useEffect(() => {
    if (!turn || !result) return;
    track('score_win_shown', { source: 'season', rank: result.rank, medal: result.medal });
    if (result.medal) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [turn, result]);

  const close = (go?: string) => {
    if (result) markSeasonSeen(result.season);
    setResult(null);
    if (go) router.navigate(go as never);
  };
  return (
    <Modal visible={turn && result !== null} transparent animationType="fade" onRequestClose={() => close()}>
      {result && <SeasonResultCard result={result} onClose={close} />}
    </Modal>
  );
}

function SeasonResultCard({ result, onClose }: { result: SeasonResult; onClose: (go?: string) => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t, i18n } = useTranslation('daily');
  const name = seasonName(result.season, i18n.language);
  return (
    <View style={styles.backdrop}>
      <Confetti run={result.medal} count={result.medal ? 40 : 0} />
      <View style={styles.card} accessibilityViewIsModal>
        <Text style={styles.kicker}>{t('season.resultsKicker', { season: name })}</Text>
        {result.medal ? <RankMedal rank={result.rank} podium size={88} /> : <Text style={styles.rankBig}>{result.rank}</Text>}
        <Text style={styles.title} accessibilityRole="header">
          {result.medal ? t('season.medalTitle', { rank: result.rank }) : t('season.rankTitle', { rank: result.rank, count: result.players })}
        </Text>
        <Text style={styles.sub}>{t('season.stats', { points: result.points, days: result.days, podiums: result.podiums })}</Text>
        {result.podium.length > 0 && (
          <View style={styles.podium}>
            {result.podium.map(p => (
              <View key={p.rank} style={styles.place} accessible accessibilityLabel={`${ordinal(p.rank, i18n.language)} ${p.user.username ? '@' + p.user.username : p.user.displayName ?? ''}, ${t('a11y.points', { count: p.points })}`}>
                <RankMedal rank={p.rank} podium size={28} />
                <Avatar uri={p.user.photoUrl} name={p.user.displayName ?? p.user.username ?? ''} size={32} />
                <Text style={styles.placeName} numberOfLines={1}>{p.user.username ? '@' + p.user.username : p.user.displayName}</Text>
                <Text style={styles.placePts}>{t('ranks.pts', { count: p.points })}</Text>
              </View>
            ))}
          </View>
        )}
        <Text style={styles.next}>{t('season.newSeason')}</Text>
        <Button label={t('season.play')} onPress={() => onClose('/(tabs)/today')} />
        <Button variant="link" label={t('season.close')} onPress={() => onClose()} />
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: c.scrim, alignItems: 'center', justifyContent: 'center', padding: Space.lg },
  card:      { width: '100%', maxWidth: 420, backgroundColor: c.bg, borderRadius: Radius.lg, padding: Space.lg, alignItems: 'center', gap: Space.md },
  kicker:    { ...Type.caption, color: c.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  rankBig:   { fontSize: 56, lineHeight: 64, fontWeight: '900', color: c.primaryText },
  title:     { ...Type.title, color: c.text, textAlign: 'center' },
  sub:       { ...Type.body, color: c.muted, textAlign: 'center' },
  podium:    { alignSelf: 'stretch', gap: Space.sm },
  place:     { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 40 },
  placeName: { flex: 1, ...Type.label, color: c.text },
  placePts:  { ...Type.caption, fontWeight: '800', color: c.primaryText },
  next:      { ...Type.body, color: c.text, textAlign: 'center' },
});
