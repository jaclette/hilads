import { useEffect, useState } from 'react';
import { Modal, ScrollView, Text, View, StyleSheet, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { FontSizes, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { CityName, Photo } from '@/ui';
import { AnswerChip } from '@/features/compare/AnswerChip';
import { captionRepeatsAnswer } from '@/features/compare/format';
import { BackHomeBlock } from '@/features/compare/BackHomeBlock';
import { useMoney } from '@/features/compare/money';
import { DailyVoteButton } from './DailyVoteButton';
import { DailyVotersSheet } from './DailyVotersSheet';
import { LocalPassBadge } from './LocalPassBadge';
import { EarlyBadge } from './EarlyBadge';
import { RankMedal } from './RankMedal';
import { Button, Chip, IconButton, ModeLabel } from '@/ui';
import { ShareSheet } from '@/features/share/ShareSheet';
import { proofShare, type ShareContent } from '@/features/share/content';
import { themeName } from './themes';
import { CommentButton } from './CommentButton';
import { commentsTargetOf, PhotoCommentsHost } from './PhotoCommentsSheet';
import { useModalStatusBar } from '@/lib/useModalStatusBar';
import type { DailyChallenge, DailyProof } from '@/types';
import { PickBadge } from '@/features/map/PickBadge';
import { PhotoCredit } from '@/features/map/PhotoCredit';

/** The photo takes at most this share of the screen height; the information block follows right under it. */
const PHOTO_MAX_HEIGHT = 0.62;

/**
 * Full-screen photo of one proof with its author, caption, price, place, local
 * badge and vote. My own proof (with its `challenge`) gets Share (SPEC 9.14);
 * `autoShare` opens the share sheet at once (yesterday's podium, "Share").
 */
export function DailyProofViewer({ proof, challenge, autoShare = false, onClose }: {
  proof: DailyProof | null; challenge?: DailyChallenge | null; autoShare?: boolean; onClose: () => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('daily');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Light status bar icons over the dark viewer.
  const shown = useModalStatusBar(!!proof);
  const [share, setShare] = useState<ShareContent | null>(null);
  const [votersOf, setVotersOf] = useState<string | null>(null);
  const money = useMoney();
  const { width, height } = useWindowDimensions();
  // The photo's width / height once loaded (square until then): its box hugs it.
  const [ratio, setRatio] = useState(1);
  useEffect(() => { setRatio(1); }, [proof?.id]);
  const shareable = !!proof && proof.isMine && !!challenge && proof.challengeId === challenge.id
    && (proof.status === 'approved' || proof.status === 'pending');
  useEffect(() => {
    if (autoShare && shareable && proof && challenge) setShare(proofShare(proof, challenge));
  }, [autoShare, shareable, proof?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!proof) return null;
  const name = proof.user.displayName || proof.user.username || '';
  return (
    <Modal visible={shown} animationType="fade" onRequestClose={onClose} presentationStyle="fullScreen" statusBarTranslucent navigationBarTranslucent>
      <View style={styles.wrap} testID="proof-viewer">
      {/* A blurred, darkened copy of the photo fills the space around it (landscape photos). */}
      <Photo thumb={proof.thumbUrl} full={proof.photoUrl} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={40} />
      <View style={[StyleSheet.absoluteFill, styles.shade]} />
      <SafeAreaView style={styles.flex}>
        {/* Below the status bar / notch (an absolute child ignores the safe area's padding). */}
        <IconButton icon="close" tone="onPhoto" onPress={onClose} label={t('back')} style={[styles.close, { top: insets.top + Spacing.sm }]} testID="viewer-close" />
        {/* Pulling down past the top (iOS bounce) closes it like a swipe-down modal; Android back closes it too. */}
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}
                    onScrollEndDrag={e => { if (e.nativeEvent.contentOffset.y < -70) onClose(); }}>
        <Image source={{ uri: proof.photoUrl }} contentFit="contain"
               style={{ width, height: Math.min(width / ratio, height * PHOTO_MAX_HEIGHT) }}
               onLoad={e => { if (e.source.width && e.source.height) setRatio(e.source.width / e.source.height); }} />
        <View style={styles.meta}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{name}</Text>
            {proof.suggestion ? <PickBadge />
              : <ModeLabel mode={proof.isLocal ? 'local' : 'traveler'} label={proof.isLocal ? t('local') : t('traveler')} />}
            {proof.user.localPass && <LocalPassBadge label onDark />}
            {proof.isEarly && <EarlyBadge onDark />}
          </View>
          {proof.city && <CityName name={proof.city.name} country={proof.city.country} short style={styles.extra} />}
          {proof.suggestion && !!proof.credit && <PhotoCredit by={null} credit={proof.credit} url={proof.creditUrl} style={styles.extra} />}
          {(proof.validatedByLocal || (proof.worldRank !== null && proof.worldRank <= 3)) && (
            <View style={styles.nameRow}>
              {proof.worldRank !== null && proof.worldRank <= 3 && (
                <View style={styles.rankRow}>
                  <RankMedal rank={proof.worldRank} size={22} />
                  <Text style={styles.rankText}>{t('results.worldRank', { rank: proof.worldRank })}</Text>
                </View>
              )}
              {proof.validatedByLocal && <Chip tone="local" icon="checkmark" label={t('validatedByLocal')} />}
            </View>
          )}
          {/* The proof's challenge: "Drinks · How do locals say cheers?", then its text (a shared link lands here). */}
          {proof.context && (
            <View style={styles.context}>
              <Text style={styles.contextHead}>
                {[proof.context.theme ? themeName(proof.context.theme.key, { special: proof.context.special, city: proof.city?.name }) : null,
                  proof.context.question].filter(Boolean).join(' · ')}
              </Text>
              {!!proof.context.text && <Text style={styles.contextText}>{proof.context.text}</Text>}
            </View>
          )}
          {proof.answer && !proof.backHome && <AnswerChip answer={proof.answer} onDark />}
          {/* Once: a caption that only repeats the answer stays out. */}
          {!!proof.caption && !captionRepeatsAnswer(proof.caption, proof.backHome ? null : proof.answer, i18n.language) && <Text style={styles.caption}>{proof.caption}</Text>}
          {proof.backHome && <BackHomeBlock proof={proof} />}
          {((proof.price && !proof.backHome) || proof.place) && (
            <View style={styles.nameRow}>
              {proof.price && !proof.backHome && (
                <View style={styles.extraRow}>
                  <Ionicons name="cash-outline" size={15} color={colors.onCaramelMuted} />
                  {/* Converted to my currency, the original after it (SPEC 10.5). */}
                  <Text style={styles.extra}>{money.price(proof.price).main}
                    {money.price(proof.price).original ? <Text style={styles.original}>{`  ${money.price(proof.price).original}`}</Text> : null}</Text>
                </View>
              )}
              {proof.place && (
                <View style={styles.extraRow}>
                  <Ionicons name="location-outline" size={15} color={colors.onCaramelMuted} />
                  <Text style={styles.extra}>{proof.place.name || t('unnamedPlace')}</Text>
                </View>
              )}
            </View>
          )}
          {proof.status === 'approved' && !proof.suggestion && (
            <DailyVoteButton proofId={proof.id} date={proof.date} cityName={proof.city?.name ?? null} cityId={proof.city?.id ?? null} source="viewer" variant="viewer"
                             onShowVoters={proof.isMine ? () => setVotersOf(proof.id) : undefined} />
          )}
          {proof.status === 'approved' && <CommentButton target={commentsTargetOf(proof)} variant="pill" />}
          {shareable && challenge && (
            <Button icon="share-social-outline" label={t('share.shareProof')} onPress={() => setShare(proofShare(proof, challenge))} />
          )}
        </View>
        </ScrollView>
        {/* A voter's profile opens over the app: the viewer closes first. */}
        <DailyVotersSheet proofId={votersOf} onClose={() => setVotersOf(null)}
                          onOpenUser={id => { setVotersOf(null); onClose(); router.push(`/user/${id}` as never); }} />
        <ShareSheet content={share} source={autoShare ? 'podium' : 'viewer'} onClose={() => setShare(null)} />
      </SafeAreaView>
      {/* Comments open above this modal; a profile from them closes it. */}
      <PhotoCommentsHost onLeave={onClose} />
      </View>
    </Modal>
  );
}

// A photo viewer is dark in both themes, like every photo lightbox (fixed photo tokens).
const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:     { flex: 1, backgroundColor: c.photoScrim },
  flex:     { flex: 1 },
  shade:    { backgroundColor: c.photoBlurShade },
  // The photo and its information block stay together, centred when they fit.
  scroll:   { flexGrow: 1, justifyContent: 'center', paddingTop: 56 },
  close:    { position: 'absolute', right: Spacing.md, zIndex: 2 },
  context:  { gap: 2 },
  contextHead: { color: c.white, fontSize: FontSizes.sm, fontWeight: '800' },
  contextText: { color: c.onCaramelMuted, fontSize: FontSizes.xs, fontWeight: '500' },
  meta:     { padding: 16, gap: 8 },
  nameRow:  { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  name:     { color: c.white, fontSize: FontSizes.md, fontWeight: '800' },
  rankRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rankText: { color: c.white, fontSize: FontSizes.xs, fontWeight: '700' },
  caption:  { color: c.white, fontSize: FontSizes.sm, fontWeight: '400' },
  extraRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  extra:    { color: c.onCaramelMuted, fontSize: FontSizes.xs, fontWeight: '500' },
  original: { color: c.onCaramelMuted, fontSize: 11, fontWeight: '400' },
});
