import { useEffect, useState } from 'react';
import { Alert, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Border, FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { shortCityName } from '@/i18n/cityName';
import { track } from '@/services/analytics';
import { setVoteViewer, toggleVote, useVoteState, useVotesLeft } from './votes';

interface Props {
  proofId:   string;
  date:      string;             // the proof's challenge date (tracking)
  cityName?: string | null;      // the proof's city ("Vote for Lisbon", tracking)
  cityId?:   number | null;      // the proof's city: mine says "Vote"
  /** vote_cast source: strip_city, strip_world, hi_card, viewer, sheet_tile. */
  source?:   string;
  variant?:  'card' | 'tile' | 'viewer' | 'strip';
}

/**
 * Vote for a proof: heart, "Vote for Lisbon" on another city's answer ("Vote"
 * on my own city's), the vote count, and my votes left while voting is open.
 * Tap again to withdraw. Disabled on my own proof and once the challenge
 * closed (count only). Guests go to the sign-up gate ("Sign up to vote for
 * Lisbon").
 */
export function DailyVoteButton({ proofId, date, cityName = null, cityId = null, source = 'card', variant = 'card' }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account, identity, city } = useApp();
  const guestId = account ? null : identity?.guestId ?? null;

  useEffect(() => { setVoteViewer(account?.id ?? (guestId ? `g:${guestId}` : null)); }, [account?.id, guestId]);
  const state = useVoteState(proofId, guestId);
  const left = useVotesLeft();
  const [busy, setBusy] = useState(false);

  const onDark = variant === 'viewer';
  const iconColor = state?.myVote ? colors.primaryText : onDark ? colors.white : colors.muted;
  const canVote = !!state && state.votingOpen && !state.isMine;
  const myCityId = city?.channelId ? Number(String(city.channelId).replace(/^city_/, '')) : null;
  const ownCity = cityId !== null && cityId === myCityId;
  const short = cityName ? shortCityName(cityName) : null;
  // "Vote for Lisbon" on another city's answer, "Vote" on my own city's.
  const voteLabel = !ownCity && short ? t('vote.voteFor', { city: short }) : t('vote.vote');

  const onPress = async () => {
    if (!state || busy) return;
    if (!account) {
      router.push(`/auth-gate?reason=daily_vote${short ? `&city=${encodeURIComponent(short)}` : ''}` as never);
      return;
    }
    if (!canVote) return;
    if (!state.myVote && left === 0) { Alert.alert(t('vote.noneLeftTitle'), t('vote.noneLeft')); return; }
    setBusy(true);
    const action = state.myVote ? 'unvote' : 'vote';
    const res = await toggleVote(proofId);
    setBusy(false);
    if (res.error) {
      Alert.alert(t(`vote.errors.${res.error}`, { defaultValue: t('errors.generic') }));
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    track('daily_vote_cast', { action, challenge_date: date, city: cityName, is_local: account.mode === 'local' });
    track('vote_cast', { action, source, challenge_date: date, city: cityName, own_city: ownCity });
  };

  const count = state ? state.voteCount : null;
  const sub = !state ? null
    : state.isMine ? t('vote.yours')
    : !state.votingOpen ? null
    : account && left !== null ? t('vote.left', { count: left })
    : null;

  return (
    <TouchableOpacity
      style={[styles.btn, variant === 'tile' && styles.btnTile, variant === 'strip' && styles.btnStrip, onDark && styles.btnDark, state?.myVote && styles.btnOn]}
      onPress={onPress}
      disabled={!state || (!!account && !canVote)}
      hitSlop={8}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected: !!state?.myVote, disabled: !canVote }}
      accessibilityLabel={state?.myVote ? t('vote.withdraw') : voteLabel}
    >
      <Ionicons name={state?.myVote ? 'heart' : 'heart-outline'} size={variant === 'tile' ? 15 : 18} color={iconColor} />
      {count !== null && (
        <Text style={[styles.count, variant === 'tile' && styles.countTile, variant === 'strip' && styles.countStrip, onDark && styles.white]}
              numberOfLines={variant === 'strip' ? 2 : 1}>
          {/* The strip's narrow card: the label alone ("Vote for Mexico City"), the count once voted. */}
          {variant !== 'tile' && !state?.myVote && !state?.isMine && state?.votingOpen
            ? (variant === 'strip' ? voteLabel : `${voteLabel} · ${count}`) : count}
        </Text>
      )}
      {!!sub && variant !== 'tile' && variant !== 'strip' && (
        <View style={styles.subWrap}><Text style={[styles.sub, onDark && styles.subDark]} numberOfLines={1}>{sub}</Text></View>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  btn:       { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 36, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full, borderWidth: Border, borderColor: c.line, backgroundColor: c.bg2 },
  btnTile:   { paddingHorizontal: 8, paddingVertical: 4, gap: 4 },
  btnStrip:  { alignSelf: 'stretch', justifyContent: 'center', minHeight: 40, paddingHorizontal: 8, gap: 4, marginTop: 4, borderRadius: 14 },
  btnDark:   { backgroundColor: c.photoControl, borderColor: c.photoControl },
  btnOn:     { borderColor: c.primary, backgroundColor: c.primaryTint },
  count:     { flexShrink: 1, fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  countTile: { fontSize: FontSizes.xs },
  countStrip: { fontSize: 12, lineHeight: 15, fontWeight: '700', textAlign: 'center' },
  white:     { color: c.white },
  subWrap:   { flexShrink: 1 },
  sub:       { fontSize: 11, fontWeight: '600', color: c.muted },
  subDark:   { color: c.onCaramelMuted },
});
