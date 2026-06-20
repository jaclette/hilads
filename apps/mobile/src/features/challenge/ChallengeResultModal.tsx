import { Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Colors, FontSizes, Radius, Spacing } from '@/constants';
import type { ChallengeReveal } from '@/api/challenges';

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

  // Host breakdown: reveal one 🙋 at a time, the running +points ticking up
  // with each, so the host *sees* "each person who showed up = points". Only
  // staggers for a sane head count; big groups show at once.
  const hb        = reveal?.hostBreakdown ?? null;
  const headCount = (reveal?.myRole === 'host' && hb && hb.heads > 0) ? hb.heads : 0;
  const staggered = headCount > 0 && headCount <= 8;
  const [revealedHeads, setRevealedHeads] = useState(0);
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
  let emoji = '🎉';
  let title = '';
  let body  = '';
  switch (myRole) {
    case 'winner':
      emoji = '👑'; title = t('result.winner.title', { defaultValue: 'You won!' });
      body = t('result.winner.body', { defaultValue: 'Your photo took the contest.' });
      break;
    case 'loser':
      emoji = '📸'; title = t('result.loser.title', { name: winnerName ?? '', defaultValue: `${winnerName ?? 'Someone'} won` });
      body = t('result.loser.body', { points: `+${myPoints}`, defaultValue: `Nice shot! You earned +${myPoints} for joining — take another shot next time 💪` });
      break;
    case 'present':
      emoji = '✅'; title = t('result.present.title', { defaultValue: 'You showed up!' });
      body = t('result.present.body', { defaultValue: 'Validated present at the meet.' });
      break;
    case 'absent':
      emoji = '👋'; title = t('result.absent.title', { defaultValue: 'You missed this one' });
      body = t('result.absent.body', { defaultValue: 'Catch the next meet — your spot is waiting.' });
      break;
    case 'host':
      emoji = '🏆';
      title = isPhoto
        ? t('result.host.titlePhoto', { name: winnerName ?? '', defaultValue: `${winnerName ?? 'Someone'} won your contest!` })
        : t('result.host.titleMeet', { defaultValue: 'Your meet is done!' });
      body = t('result.host.body', { defaultValue: 'Thanks for hosting.' });
      break;
  }

  const showPoints = myRole !== 'absent';

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
                    <Text style={styles.photoCaptionText}>👑 {winnerName}</Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <Text style={styles.bigEmoji}>{emoji}</Text>
            )}

            <Text style={styles.title}>{emoji} {title}</Text>
            {challengeTitle ? (
              <Text style={styles.challengeName} numberOfLines={2}>📌 {challengeTitle}</Text>
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
                          <PopEmoji key={i} char="🙋" />
                        ))}
                        <Text style={styles.breakdown}> = +{hb.perHead * revealedHeads}</Text>
                        {revealedHeads >= headCount ? (
                          <Text style={styles.breakdown}>   🏠 +{hb.base}</Text>
                        ) : null}
                      </>
                    ) : (
                      <Text style={styles.breakdown}>
                        {`🙋 ×${headCount} = +${hb.perHead * headCount}   🏠 +${hb.base}`}
                      </Text>
                    )}
                  </View>
                ) : null}
                {finalTotal > 0 ? (
                  <Animated.Text
                    style={[
                      styles.total,
                      {
                        color: glow.interpolate({ inputRange: [0, 1], outputRange: [Colors.muted, GOLD] }),
                        textShadowColor: GOLD,
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
                  <Text style={styles.rankFlag}>📍</Text>
                  <Text style={styles.rankLabel} numberOfLines={1}>
                    {rankCity != null
                      ? t('scoreCelebration.rank.city',       { rank: rankCity, city: cityName ?? '' })
                      : t('scoreCelebration.rank.cityBeyond', { topN: rankTopN })}
                  </Text>
                  {onOpenLeaderboard ? <Text style={styles.rankChevron}>›</Text> : null}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.rankRow}
                  activeOpacity={onOpenLeaderboard ? 0.7 : 1}
                  disabled={!onOpenLeaderboard}
                  onPress={onOpenLeaderboard ? () => onOpenLeaderboard('world') : undefined}
                >
                  <Text style={styles.rankFlag}>🌐</Text>
                  <Text style={styles.rankLabel} numberOfLines={1}>
                    {rankGlobal != null
                      ? t('scoreCelebration.rank.world',       { rank: rankGlobal })
                      : t('scoreCelebration.rank.worldBeyond', { topN: rankTopN })}
                  </Text>
                  {onOpenLeaderboard ? <Text style={styles.rankChevron}>›</Text> : null}
                </TouchableOpacity>
              </View>
            ) : null}

            <TouchableOpacity style={styles.cta} activeOpacity={0.85} onPress={onClose}>
              <Text style={styles.ctaText}>{t('result.cta', { defaultValue: 'Nice!' })}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** A person emoji that pops in (scale spring) on mount - one per attendee. */
function PopEmoji({ char }: { char: string }) {
  const s = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(s, { toValue: 1, friction: 4, tension: 170, useNativeDriver: true }).start();
  }, [s]);
  return <Animated.Text style={[styles.breakdown, { transform: [{ scale: s }] }]}>{char}</Animated.Text>;
}

const GOLD = '#FFC93C';

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)' },
  wrap:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  card: {
    width: '100%', maxWidth: 420, maxHeight: '88%',
    backgroundColor: Colors.bg2, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: 'rgba(255,201,60,0.30)', overflow: 'hidden',
  },
  scroll: { padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm },

  photoWrap: { width: '100%', borderRadius: Radius.md, overflow: 'hidden', backgroundColor: '#000' },
  photo:     { width: '100%', aspectRatio: 1 },
  photoCaption: { position: 'absolute', left: 8, bottom: 8, backgroundColor: 'rgba(255,201,60,0.95)', borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  photoCaptionText: { fontSize: FontSizes.sm, fontWeight: '800', color: '#1a1206' },

  bigEmoji: { fontSize: 64, marginTop: Spacing.sm },
  title: { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text, textAlign: 'center', letterSpacing: -0.3, marginTop: Spacing.sm },
  body:  { fontSize: FontSizes.sm, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
  challengeName: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.text, textAlign: 'center', marginTop: 2 },

  rankBlock: { alignSelf: 'stretch', marginTop: Spacing.md, gap: 8 },
  rankRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10 },
  rankFlag:  { fontSize: FontSizes.md },
  rankLabel: { flex: 1, fontSize: FontSizes.sm, fontWeight: '600', color: Colors.text },
  rankChevron: { fontSize: FontSizes.lg, color: Colors.muted, fontWeight: '700' },

  pointsBlock: { alignItems: 'center', marginTop: Spacing.xs },
  points:    { fontSize: 44, fontWeight: '900', color: GOLD, letterSpacing: -1 },
  breakdown: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.muted2, marginTop: 2 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', marginTop: 2 },
  total:     { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.muted, marginTop: 4 },

  cta: {
    marginTop: Spacing.md, alignSelf: 'stretch',
    paddingVertical: Spacing.md, borderRadius: Radius.full, alignItems: 'center',
    backgroundColor: GOLD,
  },
  ctaText: { fontSize: FontSizes.md, fontWeight: '800', color: '#1a1206' },
});
