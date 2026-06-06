import { useState, useEffect } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, Pressable, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { submitRating } from '@/api/challenges';
import { ApiError } from '@/api/client';
import { avatarColor } from '@/lib/avatarColors';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';
import type { RatePrompt } from '@/types';

const COMMENT_MAX = 500;

type Props = {
  prompt:  RatePrompt | null;
  visible: boolean;
  onClose: () => void;
  /** Fired after a successful POST so the parent can pop this prompt from
   *  its local list and surface the next one. */
  onSubmitted: (challengeId: string) => void;
};

/**
 * Bottom-sheet rating modal for a single rate-prompt. Stars (1–5, required)
 * + optional comment (≤500 chars). Posts to /challenges/:id/ratings. The
 * server's mutual-reveal gate is invisible to the rater — they always see
 * a success confirmation; whether the counterparty's rating reveals depends
 * on whether they've also rated (the trigger handles it server-side).
 */
export function RateSheet({ prompt, visible, onClose, onSubmitted }: Props) {
  const { t } = useTranslation('challenge');
  const [stars,   setStars]   = useState(0);
  const [comment, setComment] = useState('');
  const [busy,    setBusy]    = useState(false);

  // Reset every time the sheet opens for a new prompt.
  useEffect(() => {
    if (visible) { setStars(0); setComment(''); setBusy(false); }
  }, [visible, prompt?.challenge_id]);

  if (!prompt) return null;

  const canSubmit = stars >= 1 && stars <= 5 && !busy;
  const cp = prompt.counterparty;

  async function handleSubmit() {
    if (!prompt || !canSubmit) return;
    setBusy(true);
    try {
      await submitRating(prompt.challenge_id, stars, comment.trim() || null);
      onSubmitted(prompt.challenge_id);
      onClose();
    } catch (err) {
      // Stale-prompt race: the acceptance state changed between fetch and
      // submit. Surface the server's specific message (e.g. "Lock in a
      // meet-up date first.") via an Alert so the user understands WHY it
      // failed instead of seeing a silent dismiss. Pop the stale prompt
      // from parent state so it doesn't re-appear on the next interaction.
      if (err instanceof ApiError && (err.status === 409 || err.status === 403)) {
        Alert.alert(
          t('ratePrompts.staleTitle', { defaultValue: "Can't rate this yet" }),
          err.message || t('ratePrompts.errSubmit'),
        );
        onSubmitted(prompt.challenge_id);
        onClose();
        return;
      }
      Alert.alert(t('ratePrompts.errSubmit'));
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kavWrap}
        pointerEvents="box-none"
      >
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.headerRow}>
            <View style={[styles.avatar, { backgroundColor: avatarColor(cp.id) }]}>
              {cp.thumbAvatarUrl ? (
                <Image
                  source={{ uri: cp.thumbAvatarUrl }}
                  style={StyleSheet.absoluteFill}
                  cachePolicy="memory-disk"
                  contentFit="cover"
                  transition={120}
                />
              ) : (
                <Text style={styles.avatarLetter}>{(cp.displayName?.[0] ?? '?').toUpperCase()}</Text>
              )}
            </View>
            <View style={styles.headerTextWrap}>
              <Text style={styles.title}>
                {t('ratePrompts.sheet.title', { name: cp.displayName })}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {prompt.challenge_title}
              </Text>
            </View>
          </View>

          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map(n => (
              <TouchableOpacity
                key={n}
                onPress={() => setStars(n)}
                disabled={busy}
                activeOpacity={0.7}
                style={styles.starTap}
                accessibilityLabel={t('ratePrompts.sheet.starsAria', { n })}
              >
                <Ionicons
                  name={n <= stars ? 'star' : 'star-outline'}
                  size={38}
                  color={n <= stars ? '#FFC93C' : Colors.muted2}
                />
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.commentWrap}>
            <TextInput
              style={styles.comment}
              value={comment}
              onChangeText={(v) => setComment(v.slice(0, COMMENT_MAX))}
              placeholder={t('ratePrompts.sheet.commentPlaceholder')}
              placeholderTextColor={Colors.muted2}
              multiline
              maxLength={COMMENT_MAX}
              editable={!busy}
              textAlignVertical="top"
            />
            {comment.length > 0 && (
              <Text style={styles.charCount}>{comment.length}/{COMMENT_MAX}</Text>
            )}
          </View>

          <TouchableOpacity
            style={[styles.submit, !canSubmit && styles.submitDisabled]}
            disabled={!canSubmit}
            onPress={handleSubmit}
            activeOpacity={0.85}
          >
            {busy
              ? <ActivityIndicator color={Colors.white} size="small" />
              : <Text style={styles.submitText}>{t('ratePrompts.sheet.submit')}</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.skip} onPress={busy ? undefined : onClose} activeOpacity={0.7}>
            <Text style={styles.skipText}>{t('ratePrompts.sheet.later')}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  kavWrap:  { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.bg2,
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    paddingBottom: Spacing.xl,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  handle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: Spacing.md,
  },

  headerRow:     { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  avatar:        { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarLetter:  { color: '#fff', fontWeight: '700', fontSize: 18 },
  headerTextWrap:{ flex: 1, minWidth: 0 },
  title:         { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },
  subtitle:      { fontSize: FontSizes.sm, color: Colors.muted, marginTop: 2 },

  starsRow:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: Spacing.md, paddingHorizontal: Spacing.sm },
  starTap:       { padding: 4 },

  commentWrap:   { marginBottom: Spacing.md },
  comment: {
    minHeight: 80,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: Radius.md,
    padding: Spacing.sm,
    color: Colors.text,
    fontSize: FontSizes.md,
  },
  charCount: { alignSelf: 'flex-end', marginTop: 4, fontSize: FontSizes.xs, color: Colors.muted2 },

  submit: {
    backgroundColor: '#FF7A3C',
    borderRadius: Radius.full,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: Colors.white, fontSize: FontSizes.md, fontWeight: '800' },

  skip:     { paddingVertical: Spacing.sm, alignItems: 'center', marginTop: 4 },
  skipText: { color: Colors.muted, fontSize: FontSizes.sm, fontWeight: '600' },
});
