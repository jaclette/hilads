import { useEffect, useState } from 'react';
import { Alert, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { track } from '@/services/analytics';
import { setVoteViewer, toggleVote, useVoteState, useVotesLeft } from './votes';

interface Props {
  proofId:   string;
  date:      string;             // the proof's challenge date (tracking)
  cityName?: string | null;      // the proof's city (tracking)
  variant?:  'card' | 'tile' | 'viewer';
}

/**
 * Vote for a proof: heart + vote count, and my votes left while voting is
 * open. Tap again to withdraw. Disabled on my own proof and once the
 * challenge closed (count only). Guests go to the sign-up gate.
 */
export function DailyVoteButton({ proofId, date, cityName = null, variant = 'card' }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('daily');
  const router = useRouter();
  const { account, identity } = useApp();
  const guestId = account ? null : identity?.guestId ?? null;

  useEffect(() => { setVoteViewer(account?.id ?? (guestId ? `g:${guestId}` : null)); }, [account?.id, guestId]);
  const state = useVoteState(proofId, guestId);
  const left = useVotesLeft();
  const [busy, setBusy] = useState(false);

  const onDark = variant === 'viewer';
  const iconColor = state?.myVote ? colors.accent : onDark ? '#fff' : colors.muted;
  const canVote = !!state && state.votingOpen && !state.isMine;

  const onPress = async () => {
    if (!state || busy) return;
    if (!account) { router.push('/auth-gate?reason=daily_vote' as never); return; }
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
  };

  const count = state ? state.voteCount : null;
  const sub = !state ? null
    : state.isMine ? t('vote.yours')
    : !state.votingOpen ? null
    : account && left !== null ? t('vote.left', { count: left })
    : null;

  return (
    <TouchableOpacity
      style={[styles.btn, variant === 'tile' && styles.btnTile, onDark && styles.btnDark, state?.myVote && styles.btnOn]}
      onPress={onPress}
      disabled={!state || (!!account && !canVote)}
      hitSlop={8}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected: !!state?.myVote, disabled: !canVote }}
      accessibilityLabel={state?.myVote ? t('vote.withdraw') : t('vote.vote')}
    >
      <Ionicons name={state?.myVote ? 'heart' : 'heart-outline'} size={variant === 'tile' ? 15 : 18} color={iconColor} />
      {count !== null && (
        <Text style={[styles.count, variant === 'tile' && styles.countTile, onDark && styles.white]}>
          {variant === 'card' && !state?.myVote && !state?.isMine ? `${t('vote.vote')} ${count}` : count}
        </Text>
      )}
      {!!sub && variant !== 'tile' && (
        <View style={styles.subWrap}><Text style={[styles.sub, onDark && styles.subDark]} numberOfLines={1}>{sub}</Text></View>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  btn:       { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 36, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full, borderWidth: 1.5, borderColor: c.line, backgroundColor: c.bg2 },
  btnTile:   { paddingHorizontal: 8, paddingVertical: 4, gap: 4 },
  btnDark:   { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.25)' },
  btnOn:     { borderColor: c.primary, backgroundColor: c.primaryTint },
  count:     { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  countTile: { fontSize: FontSizes.xs },
  white:     { color: '#fff' },
  subWrap:   { flexShrink: 1 },
  sub:       { fontSize: 11, fontWeight: '600', color: c.muted },
  subDark:   { color: '#ddd' },
});
