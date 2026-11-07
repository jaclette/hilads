import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useReducedMotion } from 'react-native-reanimated';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useApp } from '@/context/AppContext';
import { useThemedStyles } from '@/context/ThemeContext';
import { track } from '@/services/analytics';
import type { DailyProof } from '@/types';
import { sendComment } from './comments';
import { COMMENT_MAX } from './PhotoCommentsSheet';

const QUICK = ['🔥', '😍', '😂'];

/** The bar's height above the bottom safe area (the content above it leaves this much room). */
export const COMMENT_BAR_H = 60;

/**
 * The photo viewer's inline comment bar (like a Story's "Send message"): a translucent pill
 * "Add a comment…" and three quick reactions. Focused, it rides on the keyboard (its real
 * height on every change: ABC ↔ emoji ↔ GIF) and `onComposing(true)` lets the viewer pause and
 * dim the photo. Send posts to the photo's thread (the comments sheet's API; @mentions in the
 * text work the same), a "✓ Sent" toast, the count goes up, the keyboard closes. A reaction
 * posts that emoji at once, floating up, with a haptic. Guests go to sign-up first.
 */
export function StoryCommentBar({ proof, onComposing }: { proof: DailyProof; onComposing: (composing: boolean) => void }) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation('daily');
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { account } = useApp();
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [floats, setFloats] = useState<{ id: number; emoji: string; left: number }[]>([]);
  const input = useRef<TextInput>(null);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { onComposing(focused); }, [focused]); // eslint-disable-line react-hooks/exhaustive-deps
  // Another photo: a fresh bar.
  useEffect(() => { setText(''); }, [proof.id]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); onComposing(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const say = (msg: string) => {
    if (timer.current) clearTimeout(timer.current);
    setNotice(msg);
    timer.current = setTimeout(() => setNotice(null), 1800);
  };
  const needAccount = () => {
    if (account) return false;
    Keyboard.dismiss();
    router.push('/auth-gate?reason=daily_comment' as never);
    return true;
  };
  const post = async (body: string, source: 'bar' | 'reaction') => {
    if (!account) return;
    const err = await sendComment(proof.id, body, account, null, !!proof.isMine);
    track('photo_comment_inline', { source, ok: err === null });
    if (err === null) {
      if (source === 'bar') say(`✓ ${t('comments.sent')}`);
    } else if (err === 'moderation_blocked' || err === 'invalid_body' || err === 'rate_limited') {
      if (source === 'bar') setText(body);
      say(t(`comments.errors.${err}`));
    } else if (err === 'signup_required') {
      needAccount();
    } else {
      say(t('comments.failed'));
    }
  };
  const send = () => {
    const body = text.trim();
    if (!body || needAccount()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setText('');
    input.current?.blur();
    Keyboard.dismiss();
    post(body, 'bar');
  };
  const react = (emoji: string, i: number) => {
    if (needAccount()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    if (!reduced) {
      const id = ++seq.current;
      setFloats(f => [...f, { id, emoji, left: i }]);
      setTimeout(() => setFloats(f => f.filter(x => x.id !== id)), 1100);
    }
    post(emoji, 'reaction');
  };

  return (
    <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }} style={styles.wrap} pointerEvents="box-none">
      {!!notice && <View style={styles.toast} pointerEvents="none"><Text style={styles.toastText}>{notice}</Text></View>}
      <View style={[styles.row, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.pill}>
          <TextInput
            ref={input}
            value={text}
            onChangeText={v => setText(v.slice(0, COMMENT_MAX))}
            placeholder={account ? t('comments.placeholder') : t('comments.placeholderGuest')}
            placeholderTextColor="rgba(255,255,255,0.75)"
            style={styles.input}
            onFocus={() => { if (needAccount()) { input.current?.blur(); return; } setFocused(true); }}
            onBlur={() => setFocused(false)}
            returnKeyType="send"
            submitBehavior="blurAndSubmit"
            onSubmitEditing={send}
            multiline={false}
            maxLength={COMMENT_MAX}
            accessibilityLabel={t('comments.placeholder')}
            testID="story-comment-input"
          />
          {text.trim().length > 0 && (
            <Pressable onPress={send} hitSlop={8} style={styles.send} accessibilityRole="button" accessibilityLabel={t('comments.send', { defaultValue: 'Send' })}>
              <Ionicons name="arrow-up" size={18} color="#2A1C13" />
            </Pressable>
          )}
        </View>
        {!focused && QUICK.map((e, i) => (
          <Pressable key={e} onPress={() => react(e, i)} hitSlop={4} style={styles.quick} accessibilityRole="button" accessibilityLabel={e}
                     testID={`story-react-${i}`}>
            <Text style={styles.quickText}>{e}</Text>
            {floats.filter(f => f.left === i).map(f => <Float key={f.id} emoji={f.emoji} />)}
          </Pressable>
        ))}
      </View>
    </KeyboardStickyView>
  );
}

/** A reaction floating up and away from its button. */
function Float({ emoji }: { emoji: string }) {
  const styles = useThemedStyles(makeStyles);
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(t, { toValue: 1, duration: 1000, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(); }, [t]);
  return (
    <Animated.Text pointerEvents="none" style={[styles.float, {
      opacity: t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
      transform: [
        { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -170] }) },
        { scale: t.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0.8, 1.5, 1.2] }) },
      ],
    }]}>{emoji}</Animated.Text>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  wrap:      { position: 'absolute', left: 0, right: 0, bottom: 0 },
  row:       { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8 },
  pill:      { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingLeft: 16, paddingRight: 6, borderRadius: Radius.full,
               borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)', backgroundColor: 'rgba(0,0,0,0.28)' },
  input:     { flex: 1, paddingVertical: 10, fontSize: FontSizes.sm, color: c.white },
  send:      { width: 32, height: 32, borderRadius: 16, backgroundColor: c.cta, alignItems: 'center', justifyContent: 'center' },
  quick:     { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  quickText: { fontSize: 26 },
  float:     { position: 'absolute', top: 0, fontSize: 30 },
  toast:     { alignSelf: 'center', marginBottom: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full, backgroundColor: 'rgba(0,0,0,0.7)' },
  toastText: { fontSize: FontSizes.sm, fontWeight: '800', color: c.white },
});
