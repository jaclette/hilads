import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View, TextInput, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Border, FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { submitHostRating, submitTakerRating, type ChallengeReveal } from '@/api/challenges';

/**
 * GROUP challenge result reveal modal. Role-specific, never-negative copy +
 * (photo contests) the winning photo. Driven by ChallengeResultLaunchGate.
 */
export function ChallengeResultModal({
  reveal, visible, onClose, onOpenLeaderboard,
}: {
  reveal:  ChallengeReveal | null;
  visible: boolean;
  onClose: () => void;
  onOpenLeaderboard?: (scope: 'city' | 'world') => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('challenge');

  // Count-up driver for the points + running total (hooks before any early
  // return so the rules-of-hooks order stays stable).
  const pointsAnim = useRef(new Animated.Value(0)).current;
  const glow       = useRef(new Animated.Value(0)).current; // total illuminate
  const pop        = useRef(new Animated.Value(0)).current; // total scale pop
  const [displayPoints, setDisplayPoints] = useState(0);
  const targetPoints = reveal?.myPoints ?? 0;

  useEffect(() => {
    const sub = pointsAnim.addListener(({ value }) => setDisplayPoints(Math.round(value)));
    return () => pointsAnim.removeListener(sub);
  }, [pointsAnim]);

  useEffect(() => {
    if (!visible || !reveal) { pointsAnim.setValue(0); setDisplayPoints(0); glow.setValue(0); pop.setValue(0); return; }
    pointsAnim.setValue(0);
    glow.setValue(0);
    pop.setValue(0);
    Animated.sequence([
      Animated.delay(250),
      Animated.timing(pointsAnim, {
        toValue: targetPoints,
        duration: Math.min(2400, 600 + targetPoints * 55),
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,   // count-up reads into <Text>
      }),
      // Illuminate the total once the count-up lands.
      Animated.parallel([
        Animated.timing(glow, { toValue: 1, duration: 300, easing: Easing.out(Easing.quad), useNativeDriver: false }),
        Animated.sequence([
          Animated.spring(pop, { toValue: 1, friction: 3, tension: 170, useNativeDriver: false }),
          Animated.spring(pop, { toValue: 0, friction: 5, tension: 120, useNativeDriver: false }),
        ]),
      ]),
    ]).start();
  }, [visible, reveal, targetPoints, pointsAnim, glow, pop]);

  // Host breakdown: reveal one person icon at a time, the running +points ticking up
  // with each, so the host *sees* "each person who showed up = points". Only
  // staggers for a sane head count; big groups show at once.
  const hb        = reveal?.hostBreakdown ?? null;
  const headCount = (reveal?.myRole === 'host' && hb && hb.heads > 0) ? hb.heads : 0;
  const staggered = headCount > 0 && headCount <= 8;
  const [revealedHeads, setRevealedHeads] = useState(0);
  // Photo-proof host rating (stars + note) - captured in this modal since the
  // photo flow has no validate sheet.
  const [hostStars, setHostStars] = useState(0);
  const [hostNote,  setHostNote]  = useState('');
  const [savingRating, setSavingRating] = useState(false);
  useEffect(() => {
    if (!visible) { setHostStars(0); setHostNote(''); setSavingRating(false); }
  }, [visible]);
  useEffect(() => {
    if (!visible || !reveal || headCount === 0) { setRevealedHeads(0); return; }
    if (!staggered) { setRevealedHeads(headCount); return; }
    setRevealedHeads(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= headCount; i++) {
      timers.push(setTimeout(() => setRevealedHeads(i), 350 + i * 450));
    }
    return () => { timers.forEach(clearTimeout); };
  }, [visible, reveal, headCount, staggered]);

  if (!reveal) return null;

  const { myRole, myPoints, winnerName, winnerPhotoUrl, format, myTotal,
          challengeTitle, rankCity, rankGlobal, rankTopN, cityName } = reveal;
  const isPhoto = format === 'photo';
  const showPhoto = isPhoto && !!winnerPhotoUrl;
  // Running total climbs in sync with the points count-up (start → final).
  const finalTotal   = myTotal ?? 0;
  const displayTotal = Math.max(0, finalTotal - myPoints) + displayPoints;

  // Headline + body per role (all non-negative).
  let icon: IconName = 'sparkles-outline';
  let title = '';
  let body  = '';
  switch (myRole) {
    case 'winner':
      icon = 'ribbon-outline'; title = t('result.winner.title', { defaultValue: 'You won!' });
      body = t('result.winner.body', { defaultValue: 'Your photo took the challenge.' });
      break;
    case 'loser':
      icon = 'camera-outline'; title = t('result.loser.title', { name: winnerName ?? '', defaultValue: `${winnerName ?? 'Someone'} won` });
      body = t('result.loser.body', { points: `+${myPoints}`, defaultValue: `Nice shot! You earned +${myPoints} for joining — take another shot next time 💪` });
      break;
    case 'present':
      icon = 'checkmark-circle-outline'; title = t('result.present.title', { defaultValue: 'You showed up!' });
      body = t('result.present.body', { defaultValue: 'Validated present at the meet.' });
      break;
    case 'absent':
      icon = 'hand-left-outline'; title = t('result.absent.title', { defaultValue: 'You missed this one' });
      body = t('result.absent.body', { defaultValue: 'Catch the next meet — your spot is waiting.' });
      break;
    case 'host':
      icon = 'trophy-outline';
      title = isPhoto
        ? t('result.host.titlePhoto', { name: winnerName ?? '', defaultValue: `${winnerName ?? 'Someone'} won your challenge!` })
        : t('result.host.titleMeet', { defaultValue: 'Your meet is done!' });
      body = t('result.host.body', { defaultValue: 'Thanks for hosting.' });
      break;
  }

  const showPoints = myRole !== 'absent';
  // Photo host rates here (no validate sheet in the photo flow).
  const showHostRating = myRole === 'host' && isPhoto;
  // The taker rates the challenge too, from their own reveal modal - same UI
  // as the host. Only participants who actually took part (not no-shows).
  const showTakerRating = myRole === 'winner' || myRole === 'loser' || myRole === 'present';
  const showRating = showHostRating || showTakerRating;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.card}>
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {showPhoto ? (
              <View style={styles.photoWrap}>
                <Image source={{ uri: winnerPhotoUrl! }} style={styles.photo} contentFit="cover" cachePolicy="memory-disk" />
                {winnerName ? (
                  <View style={styles.photoCaption}>
                    <Ionicons name="ribbon-outline" size={14} color={colors.onGold} />
                    <Text style={styles.photoCaptionText}>{winnerName}</Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <Ionicons name={icon} size={64} color={colors.gold} style={styles.bigIcon} />
            )}

            <View style={styles.titleRow}>
              <Ionicons name={icon} size={20} color={colors.gold} />
              <Text style={styles.title}>{title}</Text>
            </View>
            {challengeTitle ? (
              <View style={styles.challengeNameRow}>
                <Ionicons name="pin-outline" size={14} color={colors.muted} />
                <Text style={styles.challengeName} numberOfLines={2}>{challengeTitle}</Text>
              </View>
            ) : null}
            {body ? <Text style={styles.body}>{body}</Text> : null}

            {showPoints ? (
              <View style={styles.pointsBlock}>
                <Text style={styles.points}>+{displayPoints}</Text>
                {headCount > 0 && hb ? (
                  <View style={styles.breakdownRow}>
                    {staggered ? (
                      <>
                        {Array.from({ length: revealedHeads }).map((_, i) => (
                          <PopIcon key={i} name="person-outline" />
                        ))}
                        <Text style={styles.breakdown}> = +{hb.perHead * revealedHeads}</Text>
                        {revealedHeads >= headCount ? (
                          <>
                            <Ionicons name="home-outline" size={14} color={colors.mutedDim} style={styles.breakdownIconGap} />
                            <Text style={styles.breakdown}> +{hb.base}</Text>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <Ionicons name="person-outline" size={14} color={colors.mutedDim} />
                        <Text style={styles.breakdown}>{` ×${headCount} = +${hb.perHead * headCount}`}</Text>
                        <Ionicons name="home-outline" size={14} color={colors.mutedDim} style={styles.breakdownIconGap} />
                        <Text style={styles.breakdown}>{` +${hb.base}`}</Text>
                      </>
                    )}
                  </View>
                ) : null}
                {finalTotal > 0 ? (
                  <Animated.Text
                    style={[
                      styles.total,
                      {
                        color: glow.interpolate({ inputRange: [0, 1], outputRange: [colors.muted, colors.gold] }),
                        textShadowColor: colors.gold,
                        textShadowRadius: glow.interpolate({ inputRange: [0, 1], outputRange: [0, 8] }),
                        transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }],
                      },
                    ]}
                  >
                    {t('result.total', { total: displayTotal, defaultValue: `You now have ${displayTotal} points` })}
                  </Animated.Text>
                ) : null}
              </View>
            ) : null}

            {/* Current ranking - same lens as the +points celebration popin. */}
            {rankTopN != null ? (
              <View style={styles.rankBlock}>
                <TouchableOpacity
                  style={styles.rankRow}
                  activeOpacity={onOpenLeaderboard ? 0.7 : 1}
                  disabled={!onOpenLeaderboard}
                  onPress={onOpenLeaderboard ? () => onOpenLeaderboard('city') : undefined}
                >
                  <Ionicons name="location-outline" size={16} color={colors.muted} />
                  <Text style={styles.rankLabel} numberOfLines={1}>
                    {rankCity != null
                      ? t('scoreCelebration.rank.city',       { rank: rankCity, city: cityName ?? '' })
                      : t('scoreCelebration.rank.cityBeyond', { topN: rankTopN })}
                  </Text>
                  {onOpenLeaderboard ? <Ionicons name="chevron-forward" size={16} color={colors.muted} /> : null}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.rankRow}
                  activeOpacity={onOpenLeaderboard ? 0.7 : 1}
                  disabled={!onOpenLeaderboard}
                  onPress={onOpenLeaderboard ? () => onOpenLeaderboard('world') : undefined}
                >
                  <Ionicons name="globe-outline" size={16} color={colors.muted} />
                  <Text style={styles.rankLabel} numberOfLines={1}>
                    {rankGlobal != null
                      ? t('scoreCelebration.rank.world',       { rank: rankGlobal })
                      : t('scoreCelebration.rank.worldBeyond', { topN: rankTopN })}
                  </Text>
                  {onOpenLeaderboard ? <Ionicons name="chevron-forward" size={16} color={colors.muted} /> : null}
                </TouchableOpacity>
              </View>
            ) : null}

            {showRating ? (
              <View style={styles.rateBlock}>
                <Text style={styles.rateTitle}>{t('result.rateTitle', { defaultValue: 'Rate this challenge' })}</Text>
                <View style={styles.rateStars}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <TouchableOpacity key={n} onPress={() => setHostStars(n)} activeOpacity={0.7} hitSlop={{ top: 6, bottom: 6, left: 3, right: 3 }}>
                      <Ionicons name={n <= hostStars ? 'star' : 'star-outline'} size={30} color={n <= hostStars ? colors.gold : colors.line} />
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput
                  style={styles.noteInput}
                  placeholder={t('result.notePlaceholder', { defaultValue: 'Add a note (optional)' })}
                  placeholderTextColor={colors.muted}
                  value={hostNote}
                  onChangeText={setHostNote}
                  multiline
                  maxLength={500}
                />
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.cta, (savingRating || (showRating && hostStars === 0)) && { opacity: 0.5 }]}
              activeOpacity={0.85}
              disabled={savingRating || (showRating && hostStars === 0)}
              onPress={async () => {
                if (showRating && hostStars > 0) {
                  setSavingRating(true);
                  try {
                    if (showHostRating) await submitHostRating(reveal.challengeId, hostStars, hostNote);
                    else await submitTakerRating(reveal.challengeId, hostStars, hostNote);
                  } catch { /* non-fatal */ }
                  setSavingRating(false);
                }
                onClose();
              }}
            >
              {savingRating
                ? <ActivityIndicator color={colors.onGold} />
                : <Text style={styles.ctaText}>{showRating ? t('result.saveRating', { defaultValue: 'Save rating' }) : t('result.cta', { defaultValue: 'Nice!' })}</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** A person icon that pops in (scale spring) on mount - one per attendee. */
function PopIcon({ name }: { name: IconName }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const s = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(s, { toValue: 1, friction: 4, tension: 170, useNativeDriver: true }).start();
  }, [s]);
  return (
    <Animated.View style={[styles.popIcon, { transform: [{ scale: s }] }]}>
      <Ionicons name={name} size={14} color={colors.mutedDim} />
    </Animated.View>
  );
}

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: c.scrim },
  wrap:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  card: {
    width: '100%', maxWidth: 420, maxHeight: '88%',
    backgroundColor: c.bg2, borderRadius: Radius.lg,
    borderWidth: Border, borderColor: c.gold, overflow: 'hidden',
  },
  scroll: { padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm },

  photoWrap: { width: '100%', borderRadius: Radius.md, overflow: 'hidden', backgroundColor: c.photoScrim },
  photo:     { width: '100%', aspectRatio: 1 },
  photoCaption: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.gold, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  photoCaptionText: { fontSize: FontSizes.sm, fontWeight: '800', color: c.onGold },

  bigIcon: { marginTop: Spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: Spacing.sm },
  title: { flexShrink: 1, fontSize: FontSizes.lg, fontWeight: '800', color: c.text, textAlign: 'center', letterSpacing: -0.3 },
  body:  { fontSize: FontSizes.sm, color: c.muted, textAlign: 'center', lineHeight: 20 },
  challengeNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 2 },
  challengeName: { flexShrink: 1, fontSize: FontSizes.sm, fontWeight: '700', color: c.text, textAlign: 'center' },

  rankBlock: { alignSelf: 'stretch', marginTop: Spacing.md, gap: 8 },
  rankRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.bg3, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  rankLabel: { flex: 1, fontSize: FontSizes.sm, fontWeight: '600', color: c.text },

  rateBlock: { alignSelf: 'stretch', alignItems: 'center', gap: 8, marginTop: Spacing.md },
  rateTitle: { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  rateStars: { flexDirection: 'row', gap: 8 },
  noteInput: {
    alignSelf: 'stretch', minHeight: 44, maxHeight: 100, borderRadius: Radius.md,
    backgroundColor: c.bg3, color: c.text,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: FontSizes.sm, textAlignVertical: 'top',
  },

  pointsBlock: { alignItems: 'center', marginTop: Spacing.xs },
  points:    { fontSize: 44, fontWeight: '900', color: c.gold, letterSpacing: -1 },
  breakdown: { fontSize: FontSizes.sm, fontWeight: '700', color: c.mutedDim, marginTop: 2 },
  breakdownIconGap: { marginLeft: 12 },
  popIcon:   { marginTop: 2 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', marginTop: 2 },
  total:     { fontSize: FontSizes.sm, fontWeight: '700', color: c.muted, marginTop: 4 },

  cta: {
    marginTop: Spacing.md, alignSelf: 'stretch',
    paddingVertical: Spacing.md, borderRadius: Radius.full, alignItems: 'center',
    backgroundColor: c.gold,
  },
  ctaText: { fontSize: FontSizes.md, fontWeight: '800', color: c.onGold },
});
