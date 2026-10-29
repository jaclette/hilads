import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useApp } from '@/context/AppContext';
import { useThemedStyles } from '@/context/ThemeContext';
import { isBlocked } from '@/lib/blockFilter';
import { thumbUrl } from '@/lib/imageThumb';
import { Avatar } from '@/ui';
import { useCommentSummary } from './comments';
import { openPhotoComments, type CommentsTarget } from './PhotoCommentsSheet';

const NEW_FOR_MS = 5 * 60_000;

/**
 * Under a photo's post in the Hi chat: its 2 latest comments (one line each)
 * and "See all N comments"; a tap opens the comments. Live: a new comment
 * flashes softly and "New comments" shows for a few minutes. Nothing at 0.
 */
export function CommentPreview({ target }: { target: CommentsTarget }) {
  const { t } = useTranslation('daily');
  const styles = useThemedStyles(makeStyles);
  const reduced = useReducedMotion();
  const { identity, blockedSet } = useApp();
  const { count, latest, bumpedAt } = useCommentSummary(target.proofId, identity?.guestId ?? null);
  const shown = latest.filter(c => !isBlocked(c.user.id, null, blockedSet));
  const fresh = bumpedAt !== null && Date.now() - bumpedAt < NEW_FOR_MS;

  const glow = useSharedValue(0);
  useEffect(() => {
    if (bumpedAt === null || reduced) return;
    glow.value = withSequence(withTiming(1, { duration: 150 }), withTiming(0, { duration: 1800 }));
  }, [bumpedAt, reduced, glow]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  if (count === 0 || shown.length === 0) return null;
  return (
    <Pressable onPress={() => openPhotoComments(target)} style={styles.wrap} accessibilityRole="button"
               accessibilityLabel={t('comments.seeAll', { count })}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.glow, glowStyle]} />
      {fresh && (
        <View style={styles.newPill}><Text style={styles.newText}>{t('comments.newComments')}</Text></View>
      )}
      {shown.map(c => (
        <View key={c.id} style={styles.row}>
          <Avatar uri={c.user.photoUrl ? thumbUrl(c.user.photoUrl) : null} name={c.user.displayName || c.user.username || '?'} size={20} fallback="color" />
          <Text style={styles.line} numberOfLines={1}>
            <Text style={styles.handle}>{c.user.username ? `@${c.user.username}` : c.user.displayName}</Text>
            {'  '}{c.body.replace(/\s+/g, ' ')}
          </Text>
        </View>
      ))}
      {count > shown.length && <Text style={styles.seeAll}>{t('comments.seeAll', { count })}</Text>}
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:    { gap: 6, paddingVertical: 6, paddingHorizontal: 4, borderRadius: Radius.md, overflow: 'hidden' },
  glow:    { backgroundColor: c.highlightBg },
  newPill: { alignSelf: 'flex-start', backgroundColor: c.primaryTint, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  newText: { fontSize: FontSizes.tiny, fontWeight: '700', color: c.primaryOnTint },
  row:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  line:    { flex: 1, fontSize: FontSizes.sm, fontWeight: '400', color: c.text },
  handle:  { fontWeight: '700' },
  seeAll:  { fontSize: FontSizes.xs, fontWeight: '700', color: c.muted },
});
