/**
 * ProofReviewModal — full-screen verdict surface for the international
 * challenge creator. Opens from the lifecycle pipeline's "Review the
 * proof" sub-CTA. Shows the acceptor's photo large + Approve / Reject
 * buttons; reject swaps the same sheet into a reason-prompt face
 * (1–200 chars, mandatory).
 *
 * Why a modal (PR62): the inline verdict row inside ChallengeProofBlock
 * lived under the pipeline and was easy to miss. The photo itself was
 * in the channel chat, so the creator had to scroll, find it, scroll
 * back to the buttons, and tap. Surfacing the photo + buttons together
 * in a modal makes the action obvious.
 *
 * WS — approve/reject endpoints now broadcast challenge_accepted on
 * both sides (creator + acceptor); existing socket listeners refresh
 * the acceptance, the modal closes itself on success, and the pipeline
 * + chat update on both clients without a manual reload.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Modal, View, Text, Pressable, TouchableOpacity,
  StyleSheet, ActivityIndicator, TextInput, ScrollView,
} from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import {
  fetchProofs, approveProof, rejectProof, type ChallengeProof,
} from '@/api/challenges';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

type Props = {
  visible:        boolean;
  onClose:        () => void;
  acceptanceId:   string;
  /** Called after a successful approve/reject so the parent can refresh
   *  its own acceptance + pipeline state. The WS broadcast also fires
   *  to both sides, so this is mostly an extra nudge for the local
   *  screen's loadMyAcceptance(). */
  onVerdict?:     () => void;
};

export function ProofReviewModal({ visible, onClose, acceptanceId, onVerdict }: Props) {
  const { t } = useTranslation('challenge');

  const [proof,       setProof]       = useState<ChallengeProof | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState(3);
  const [loading,     setLoading]     = useState(true);
  const [busy,        setBusy]        = useState<'approve' | 'reject' | null>(null);
  const [mode,        setMode]        = useState<'verdict' | 'reason'>('verdict');
  const [reason,      setReason]      = useState('');
  const [error,       setError]       = useState<string | null>(null);

  // Reset + fetch every time the modal opens. The acceptor may have
  // re-submitted a fresh proof between two opens, so we never trust a
  // cached value.
  useEffect(() => {
    if (!visible) return;
    setMode('verdict');
    setReason('');
    setError(null);
    setBusy(null);
    setLoading(true);
    (async () => {
      try {
        const data = await fetchProofs(acceptanceId);
        const latestPending = data.proofs.find(p => p.status === 'pending') ?? null;
        setProof(latestPending);
        setAttemptsLeft(Math.max(0, data.maxAttempts - data.attempts));
      } catch {
        setProof(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [visible, acceptanceId]);

  const handleApprove = useCallback(async () => {
    if (!proof || busy) return;
    setBusy('approve');
    setError(null);
    try {
      await approveProof(proof.id);
      onVerdict?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('intl.proof.reviewFailTitle'));
    } finally {
      setBusy(null);
    }
  }, [proof, busy, onClose, onVerdict, t]);

  const handleReject = useCallback(async () => {
    if (!proof || busy) return;
    const r = reason.trim();
    if (r.length === 0 || r.length > 200) {
      setError(t('intl.proof.reasonRequiredBody'));
      return;
    }
    setBusy('reject');
    setError(null);
    try {
      await rejectProof(proof.id, r);
      onVerdict?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('intl.proof.reviewFailTitle'));
    } finally {
      setBusy(null);
    }
  }, [proof, busy, reason, onClose, onVerdict, t]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={() => !busy && onClose()} />
      <View style={styles.sheet}>
        <View style={styles.handle} />

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={Colors.muted} />
          </View>
        ) : !proof ? (
          <View style={styles.loadingWrap}>
            <Text style={styles.emptyText}>{t('intl.proof.waitingVerdict')}</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll}>
            <Text style={styles.title}>
              {mode === 'verdict' ? t('intl.proof.reviewModalTitle', { defaultValue: 'Review the proof' })
                                  : t('intl.proof.rejectModalTitle')}
            </Text>

            <Image
              source={{ uri: proof.media_url }}
              style={styles.image}
              contentFit="cover"
              transition={120}
            />

            {mode === 'verdict' ? (
              <View style={styles.verdictRow}>
                <TouchableOpacity
                  style={[styles.btn, styles.btnReject, busy && { opacity: 0.5 }]}
                  onPress={() => { setError(null); setMode('reason'); }}
                  disabled={!!busy}
                  activeOpacity={0.85}
                >
                  <Text style={styles.btnRejectText}>✕ {t('intl.proof.rejectCta')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btn, styles.btnApprove, busy && { opacity: 0.5 }]}
                  onPress={handleApprove}
                  disabled={!!busy}
                  activeOpacity={0.85}
                >
                  {busy === 'approve'
                    ? <ActivityIndicator color={Colors.white} size="small" />
                    : <Text style={styles.btnApproveText}>✓ {t('intl.proof.approveCta')}</Text>}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={{ gap: Spacing.sm }}>
                <Text style={styles.hint}>{t('intl.proof.rejectModalHint', { count: attemptsLeft })}</Text>
                <TextInput
                  style={styles.reasonInput}
                  value={reason}
                  onChangeText={setReason}
                  placeholder={t('intl.proof.reasonPlaceholder')}
                  placeholderTextColor={Colors.muted2}
                  maxLength={200}
                  multiline
                  autoFocus
                />
                <Text style={styles.charCount}>{reason.length} / 200</Text>
                <View style={styles.verdictRow}>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnSecondary]}
                    onPress={() => { setReason(''); setError(null); setMode('verdict'); }}
                    disabled={!!busy}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.btnSecondaryText}>{t('cancel', { defaultValue: 'Back' })}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnReject, (!reason.trim() || busy === 'reject') && { opacity: 0.5 }]}
                    onPress={handleReject}
                    disabled={!reason.trim() || busy === 'reject'}
                    activeOpacity={0.85}
                  >
                    {busy === 'reject'
                      ? <ActivityIndicator color={Colors.white} size="small" />
                      : <Text style={styles.btnRejectText}>{t('intl.proof.rejectConfirm')}</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {error ? <Text style={styles.errorLine}>{error}</Text> : null}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '88%',
    backgroundColor: Colors.bg2,
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    paddingBottom: Spacing.xl,
  },
  handle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)', marginTop: 8, marginBottom: 4,
  },
  scroll: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, gap: Spacing.md },
  loadingWrap: { padding: Spacing.xl, alignItems: 'center' },
  title:    { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },
  image:    { width: '100%', aspectRatio: 1, borderRadius: Radius.md, backgroundColor: '#111' },
  hint:     { fontSize: FontSizes.sm, color: Colors.muted },
  emptyText:{ fontSize: FontSizes.sm, color: Colors.muted },

  verdictRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  btn: { flex: 1, paddingVertical: 14, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  btnApprove: { backgroundColor: '#4ade80' },
  btnApproveText: { color: '#0b0d12', fontSize: FontSizes.md, fontWeight: '800' },
  btnReject:  { backgroundColor: '#ef4444' },
  btnRejectText:  { color: Colors.white, fontSize: FontSizes.md, fontWeight: '800' },
  btnSecondary: { backgroundColor: 'rgba(255,255,255,0.08)' },
  btnSecondaryText: { color: Colors.muted, fontSize: FontSizes.md, fontWeight: '700' },

  reasonInput: {
    minHeight: 96,
    padding: 12,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(255,255,255,0.05)',
    color: Colors.text,
    fontSize: FontSizes.sm,
    textAlignVertical: 'top',
  },
  charCount: { alignSelf: 'flex-end', fontSize: FontSizes.xs, color: Colors.muted2 },
  errorLine: { color: '#ef4444', fontSize: FontSizes.sm, marginTop: 4 },
});
