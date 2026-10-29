import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useApp } from '@/context/AppContext';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useCommentSummary } from './comments';
import { openPhotoComments, type CommentsTarget } from './PhotoCommentsSheet';

/**
 * The 💬 of a Daily photo, live: opens its comments.
 * - `pill`: a labelled pill (the photo viewer, on dark);
 * - `side`: icon over count, for the right rail of the story / photos viewers;
 * - `inline`: icon + count in an action row (the chat card);
 * - `count`: display only, small (the mosaic's cards; hidden at 0).
 */
export function CommentButton({ target, variant, style }: {
  target: CommentsTarget;
  variant: 'pill' | 'side' | 'inline' | 'count';
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation('daily');
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { identity } = useApp();
  const { count } = useCommentSummary(target.proofId, identity?.guestId ?? null);
  const label = t('comments.count', { count });

  if (variant === 'count') {
    if (count === 0) return null;
    return (
      <View style={[styles.countRow, style]} accessibilityLabel={label}>
        <Ionicons name="chatbubble" size={13} color={colors.muted} />
        <Text style={styles.countText}>{count}</Text>
      </View>
    );
  }
  const open = () => openPhotoComments(target);
  if (variant === 'side') {
    return (
      <Pressable onPress={open} style={[styles.side, style]} hitSlop={8} accessibilityRole="button" accessibilityLabel={label}>
        <Ionicons name="chatbubble-ellipses" size={30} color={colors.white} style={styles.shadow} />
        <Text style={[styles.sideText, styles.shadow]}>{count > 0 ? count : t('comments.comment')}</Text>
      </Pressable>
    );
  }
  if (variant === 'inline') {
    return (
      <Pressable onPress={open} style={[styles.inline, style]} hitSlop={6} accessibilityRole="button" accessibilityLabel={label}>
        <Ionicons name="chatbubble-outline" size={19} color={colors.text} />
        {count > 0 && <Text style={styles.inlineText}>{count}</Text>}
      </Pressable>
    );
  }
  return (
    <Pressable onPress={open} style={[styles.pill, style]} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.white} />
      <Text style={styles.pillText}>{count > 0 ? label : t('comments.comment')}</Text>
    </Pressable>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  countRow:   { flexDirection: 'row', alignItems: 'center', gap: 3 },
  countText:  { fontSize: FontSizes.xs, fontWeight: '700', color: c.muted },
  side:       { alignItems: 'center', gap: 2, minWidth: 48 },
  sideText:   { fontSize: FontSizes.xs, fontWeight: '700', color: c.white },
  shadow:     { textShadowColor: c.photoBlurShade, textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  inline:     { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, paddingHorizontal: 4 },
  inlineText: { fontSize: FontSizes.sm, fontWeight: '700', color: c.text },
  pill:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44, borderRadius: Radius.full,
                paddingHorizontal: 18, backgroundColor: c.photoButton },
  pillText:   { fontSize: FontSizes.sm, fontWeight: '700', color: c.white },
});
