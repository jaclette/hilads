import { useEffect, useRef } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { localizeCityName } from '@/i18n/cityName';
import { track } from '@/services/analytics';
import { formatCountdown } from '@/hooks/useDaily';
import { RankMedal } from './RankMedal';
import { Chip, CityFlag, CityName, EmptyState, ModeLabel } from '@/ui';
import { dailyTrackProps } from './track';
import { useDailyLeaderboard } from './leaderboard';
import { LocalPassBadge } from './LocalPassBadge';
import type { DailyLeaderboardEntry, DailyProof, DailySheet } from '@/types';

interface Props {
  sheet:       DailySheet;
  secondsLeft: number | null;
  source:      string;                       // daily_leaderboard_viewed source
  onOpenProof: (proofId: string) => void;
}

/**
 * The sheet's "Top 10" tab. While the challenge is active: the provisional
 * leaderboard (my rank, World top 10, top 3 of each live city), live. Once
 * closed: the official podium (World top 3, best of each live city).
 */
export function DailyLeaderboardPanel({ sheet, secondsLeft, source, onOpenProof }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const { account, identity } = useApp();
  const guestId = account ? null : identity?.guestId ?? null;
  const active = !!sheet.challenge?.isActive;
  const lb = useDailyLeaderboard(active, account?.id ?? (guestId ? `g:${guestId}` : null), guestId);
  const board = lb && lb.date === sheet.challenge?.date ? lb : null;

  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current || (active && !board)) return;
    tracked.current = true;
    track('daily_leaderboard_viewed', {
      source, ...dailyTrackProps(sheet, account?.mode),
      provisional: active, ranked: active ? !!board?.ranked : !!sheet.results, my_rank: board?.me?.rank ?? null,
    });
  }, [active, board, sheet, source, account?.mode]);

  if (!active) {
    const results = sheet.results;
    return (
      <View style={styles.section}>
        <Title icon="trophy-outline" text={t('leaderboard.official')} />
        {!results || (results.world.length === 0 && results.cities.length === 0) ? (
          <Text style={styles.muted}>{t('results.none')}</Text>
        ) : (
          <>
            {results.world.map((p, i) => (
              <ResultRow key={p.id} proof={p} rank={i + 1} onPress={() => onOpenProof(p.id)} />
            ))}
            {results.cities.length > 0 && <Title icon="location-outline" text={t('results.bestInCities')} sub />}
            {results.cities.map(p => (
              <ResultRow key={`c${p.id}`} proof={p} city onPress={() => onOpenProof(p.id)} />
            ))}
          </>
        )}
      </View>
    );
  }

  const myProof = sheet.myProof;
  return (
    <View style={styles.section}>
      <Title icon="trophy-outline" text={t('leaderboard.tab')} />
      <Text style={styles.muted}>
        {t('leaderboard.provisional')}
        {secondsLeft !== null ? ` · ${t('leaderboard.finalIn', { time: formatCountdown(secondsLeft) })}` : ''}
      </Text>

      {board?.me ? (
        <View style={styles.me}>
          <Text style={styles.meText}>{t('leaderboard.me', { rank: board.me.rank, votes: board.me.voteCount })}</Text>
          {board.me.cityRank !== null && myProof?.city && (
            <Text style={styles.meSub}>{t('leaderboard.meCity', { rank: board.me.cityRank, city: localizeCityName(myProof.city.name) })}</Text>
          )}
        </View>
      ) : (
        <Text style={styles.hint}>{myProof?.status === 'pending' ? t('leaderboard.pending') : !myProof ? t('leaderboard.noProof') : ''}</Text>
      )}

      {!board ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : !board.ranked ? (
        <EmptyState icon="flame-outline" body={t('leaderboard.minProofs', { min: board.minProofs, n: board.approvedCount })} />
      ) : board.world.length === 0 ? (
        <EmptyState icon="heart-outline" body={t('leaderboard.noVotes')} />
      ) : (
        <>
          {board.world.map(e => (
            <EntryRow key={e.proofId} entry={e} mine={e.proofId === board.me?.proofId} onPress={() => onOpenProof(e.proofId)} />
          ))}
          {board.cities.map(c => (
            <View key={c.city.id} style={styles.city}>
              <Title icon="location-outline" flag={c.city.country} text={t('leaderboard.cityTop', { city: localizeCityName(c.city.name) })} sub />
              {c.entries.map(e => (
                <EntryRow key={`${c.city.id}:${e.proofId}`} entry={e} mine={e.proofId === board.me?.proofId} hideCity onPress={() => onOpenProof(e.proofId)} />
              ))}
            </View>
          ))}
        </>
      )}
    </View>
  );
}

/** A section title with its stroke icon. */
function Title({ icon, flag, text, sub = false }: { icon: React.ComponentProps<typeof Ionicons>['name']; flag?: string | null; text: string; sub?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <View style={[styles.titleRow, sub && styles.sub]}>
      {flag ? <CityFlag country={flag} /> : <Ionicons name={icon} size={16} color={colors.primaryText} />}
      <Text style={styles.title} accessibilityRole="header">{text}</Text>
    </View>
  );
}

/** Votes with a heart. */
function Votes({ count }: { count: number }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <View style={styles.votesRow}>
      <Ionicons name="heart" size={13} color={colors.muted} />
      <Text style={styles.votes}>{count}</Text>
    </View>
  );
}

/** One leaderboard line: rank seal, photo, name · city, votes. */
function EntryRow({ entry, mine, hideCity = false, onPress }: {
  entry: DailyLeaderboardEntry; mine: boolean; hideCity?: boolean; onPress: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const name = entry.user.displayName || entry.user.username || '';
  return (
    <TouchableOpacity style={[styles.row, mine && styles.rowMine]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`#${entry.rank} ${name}`}>
      <RankMedal rank={entry.rank} size={28} style={styles.rank} />
      {entry.thumbUrl
        ? <Image source={{ uri: entry.thumbUrl }} style={styles.thumb} contentFit="cover" />
        : <View style={styles.thumb} />}
      <View style={styles.body}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {entry.user.localPass && <LocalPassBadge />}
        </View>
        <View style={styles.labels}>
          <ModeLabel mode={entry.isLocal ? 'local' : 'traveler'} label={entry.isLocal ? t('local') : t('traveler')} />
          {!hideCity && entry.city && <CityName name={entry.city.name} country={entry.city.country} short style={styles.rowSub} size={14} />}
        </View>
      </View>
      <Votes count={entry.voteCount} />
    </TouchableOpacity>
  );
}

/** One official results line: rank seal (or pin), photo, author · city (or "Best in <city>"), votes. */
function ResultRow({ proof, rank, city = false, onPress }: { proof: DailyProof; rank?: number; city?: boolean; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const name = proof.user.displayName || proof.user.username || '';
  const cityName = proof.city ? localizeCityName(proof.city.name) : '';
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={rank ? `#${rank} ${name}` : name}>
      {rank
        ? <RankMedal rank={rank} size={28} style={styles.rank} />
        : <View style={styles.rank}>{proof.city?.country ? <CityFlag country={proof.city.country} size={20} /> : <Ionicons name="location-outline" size={18} color={colors.primaryText} />}</View>}
      <Image source={{ uri: proof.thumbUrl ?? proof.photoUrl }} style={styles.thumb} contentFit="cover" />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{city ? t('results.bestIn', { city: cityName }) : name}</Text>
        <View style={styles.labels}>
          {city || !proof.city ? <Text style={styles.rowSub} numberOfLines={1}>{city ? name : cityName}</Text>
            : <CityName name={proof.city.name} country={proof.city.country} short style={styles.rowSub} size={14} />}
          {proof.validatedByLocal && <Chip tone="local" icon="checkmark" label={t('validatedByLocal')} />}
        </View>
      </View>
      <Votes count={proof.voteCount} />
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  section:  { backgroundColor: c.bg2, borderRadius: Radius.card, borderWidth: Border, borderColor: c.line, padding: 14, gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title:    { fontSize: 15, fontWeight: '800', color: c.text },
  sub:      { marginTop: 8 },
  muted:    { fontSize: 12, fontWeight: '500', color: c.muted },
  hint:     { fontSize: 12, fontWeight: '500', color: c.muted },
  me:       { backgroundColor: c.primaryTint, borderRadius: Radius.button, paddingVertical: 10, paddingHorizontal: 12, gap: 2, marginVertical: 4 },
  meText:   { fontSize: FontSizes.sm, fontWeight: '800', color: c.primaryOnTint },
  meSub:    { fontSize: 12, fontWeight: '600', color: c.primaryOnTint },
  loader:   { marginVertical: 20 },
  city:     { gap: 6 },
  row:      { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 4, paddingHorizontal: 6, borderRadius: Radius.button,
              borderWidth: Border, borderColor: 'transparent' },
  rowMine:  { borderColor: c.primary, backgroundColor: c.primaryTint },
  rank:     { width: 32, alignItems: 'center', justifyContent: 'center' },
  thumb:    { width: 44, height: 44, borderRadius: 10, backgroundColor: c.bg3 },
  body:     { flex: 1, gap: 3 },
  nameRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name:     { flexShrink: 1, fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  labels:   { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  rowSub:   { flexShrink: 1, fontSize: 12, fontWeight: '500', color: c.muted },
  votesRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  votes:    { fontSize: FontSizes.xs, fontWeight: '800', color: c.text },
});
