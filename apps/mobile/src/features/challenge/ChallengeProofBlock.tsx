/**
 * ChallengeProofBlock - proof flow surface for International challenges.
 *
 * Renders three faces depending on who's viewing + the latest proof state:
 *
 *   ACCEPTOR (phase='accepted', no proofs yet)
 *      → "Submit your proof" CTA. Tap opens the picker + GPS capture.
 *
 *   ACCEPTOR (phase='proof_submitted', latest proof pending)
 *      → "Waiting for verdict" + media preview.
 *
 *   ACCEPTOR (latest proof rejected, attempts remaining)
 *      → "Try again" CTA + the creator's rejection reason inline.
 *
 *   CREATOR (latest proof pending)
 *      → Media preview + Approve / Reject buttons. Reject opens a reason
 *        prompt (mandatory, 1–200 chars).
 *
 *   CREATOR / ACCEPTOR (terminal)
 *      → A short status line ("Accomplished" or "Closed"). The pipeline above
 *        already carries the canonical state; this block stays compact.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, TextInput, Pressable, Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import {
  fetchProofs, submitProof, approveProof, rejectProof,
  type ChallengeProof,
} from '@/api/challenges';
import { uploadFile } from '@/api/uploads';
import { AndroidCameraCapture } from '@/features/chat/AndroidCameraCapture';
import { Colors, FontSizes, Spacing, Radius } from '@/constants';

type Props = {
  acceptanceId: string;
  iAmCreator:   boolean;
  iAmAcceptor:  boolean;
  proofRequirements: string | null;
  /** PR57 - when the parent's acceptance.phase changes (e.g. via a WS
   *  refresh triggered by the OTHER party's submit/approve/reject),
   *  the proof block re-fetches so the verdict buttons / banner switch
   *  to the new state without an app relaunch. Optional - older
   *  callers continue to work, but the WS-triggered refresh won't
   *  fire unless they pass this. */
  acceptancePhase?: string;
};

export function ChallengeProofBlock({
  acceptanceId, iAmCreator, iAmAcceptor, proofRequirements, acceptancePhase,
}: Props) {
  const { t } = useTranslation('challenge');
  const [proofs,      setProofs]      = useState<ChallengeProof[]>([]);
  const [attempts,    setAttempts]    = useState(0);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [loading,     setLoading]     = useState(true);
  const [busy,        setBusy]        = useState<'submit' | 'approve' | 'reject' | null>(null);
  const [rejectOpen,  setRejectOpen]  = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [androidCamera, setAndroidCamera] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchProofs(acceptanceId);
      setProofs(data.proofs);
      setAttempts(data.attempts);
      setMaxAttempts(data.maxAttempts);
    } catch {
      // soft-fail - the block renders the "no proofs yet" branch
      setProofs([]);
    } finally {
      setLoading(false);
    }
  }, [acceptanceId]);

  // PR57 - also re-fetches whenever the parent reports a new
  // acceptancePhase. The phase string changes when the parent's
  // WS-driven loadMyAcceptance returns (proof_submitted → approved,
  // accepted → proof_submitted, etc.), so the proof card refreshes
  // without an app relaunch on the OTHER party's side.
  useEffect(() => { load(); }, [load, acceptancePhase]);

  const latest = proofs[0] ?? null;
  const attemptsLeft = Math.max(0, maxAttempts - attempts);
  const isFinal = latest?.status === 'rejected' && attemptsLeft === 0;

  // ── Acceptor: submit a proof ──────────────────────────────────────────────
  // Shared tail: upload the captured photo → submit the proof → refresh. Both
  // the iOS picker path and the Android in-app camera path funnel through here.
  const submitWithUri = useCallback(async (uri: string, mimeType: string | null) => {
    setBusy('submit');
    try {
      const { url } = await uploadFile(uri, mimeType);
      await submitProof(acceptanceId, { mediaUrl: url, mediaType: 'image' });
      await load();
    } catch (e) {
      Alert.alert(t('intl.proof.submitFailTitle'), e instanceof Error ? e.message : t('intl.proof.submitFailBody'));
    } finally {
      setBusy(null);
    }
  }, [acceptanceId, load, t]);

  const handleSubmit = useCallback(async () => {
    if (busy) return;

    // Android: expo-image-picker's launchCameraAsync() HANGS on Android 14 +
    // singleTask MainActivity (the ActivityResultLauncher callback is never
    // delivered across task boundaries) - the call never resolves, so the
    // button "did nothing". Use the same in-app expo-camera modal the chat
    // composer uses. Still a live camera capture (PR55 anti-cheat intact).
    if (Platform.OS === 'android') {
      setAndroidCamera(true);
      return;
    }

    // iOS: launchCameraAsync works. Wrap the whole flow so a denied permission
    // / camera-unavailable / picker error surfaces as an alert, never silence.
    try {
      const cam = await ImagePicker.requestCameraPermissionsAsync();
      if (cam.status !== 'granted') {
        Alert.alert(t('intl.proof.permPhotoTitle'), t('intl.proof.permPhotoBody'));
        return;
      }
      const pick = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality:    0.85,
        cameraType: ImagePicker.CameraType.back,  // place/dish, not a selfie
        allowsEditing: false,
      });
      if (pick.canceled || !pick.assets?.[0]) return;
      await submitWithUri(pick.assets[0].uri, pick.assets[0].mimeType ?? null);
    } catch (e) {
      Alert.alert(t('intl.proof.submitFailTitle'), e instanceof Error ? e.message : t('intl.proof.submitFailBody'));
    }
  }, [busy, submitWithUri, t]);

  // ── Creator: approve / reject ─────────────────────────────────────────────
  const handleApprove = useCallback(async () => {
    if (!latest || busy) return;
    setBusy('approve');
    try {
      await approveProof(latest.id);
      await load();
    } catch (e) {
      Alert.alert(t('intl.proof.reviewFailTitle'), e instanceof Error ? e.message : '');
    } finally {
      setBusy(null);
    }
  }, [latest, busy, load, t]);

  const handleReject = useCallback(async () => {
    if (!latest || busy) return;
    const reason = rejectReason.trim();
    if (reason.length === 0 || reason.length > 200) {
      Alert.alert(t('intl.proof.reasonRequiredTitle'), t('intl.proof.reasonRequiredBody'));
      return;
    }
    setBusy('reject');
    try {
      await rejectProof(latest.id, reason);
      setRejectOpen(false);
      setRejectReason('');
      await load();
    } catch (e) {
      Alert.alert(t('intl.proof.reviewFailTitle'), e instanceof Error ? e.message : '');
    } finally {
      setBusy(null);
    }
  }, [latest, busy, rejectReason, load, t]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.card, { alignItems: 'center' }]}>
        <ActivityIndicator color={Colors.muted} />
      </View>
    );
  }

  // Terminal - short status line; the pipeline above carries the icon.
  if (latest?.status === 'approved') {
    return (
      <View style={styles.card}>
        <Text style={styles.terminalLine}>🎉 {t('intl.proof.approvedLine')}</Text>
      </View>
    );
  }
  if (latest?.status === 'rejected' && isFinal) {
    return (
      <View style={styles.card}>
        <Text style={styles.terminalLine}>{t('intl.proof.closedLine')}</Text>
        {latest.rejection_reason ? (
          <Text style={styles.reasonLine} numberOfLines={3}>
            {t('intl.proof.lastReason', { reason: latest.rejection_reason })}
          </Text>
        ) : null}
      </View>
    );
  }

  // Pending - creator reviews; acceptor waits.
  if (latest?.status === 'pending') {
    // PR62 - creator's verdict UI moved into ProofReviewModal (opened
    // from the pipeline's "Review the proof" sub-CTA). The photo lives
    // in the chat thread above already, so leaving an inline button
    // pair here with no photo was confusing. Skip the card entirely
    // for creators; render the acceptor's "Waiting for verdict" line
    // unchanged.
    if (iAmCreator) return null;
    return (
      <View style={styles.card}>
        {iAmCreator ? (
          <View style={styles.verdictRow}>
            <TouchableOpacity
              style={[styles.verdictBtn, styles.verdictApprove, busy && { opacity: 0.5 }]}
              onPress={handleApprove}
              disabled={!!busy}
              activeOpacity={0.85}
            >
              {busy === 'approve'
                ? <ActivityIndicator color={Colors.white} size="small" />
                : <Text style={styles.verdictApproveText}>✓ {t('intl.proof.approveCta')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.verdictBtn, styles.verdictReject, busy && { opacity: 0.5 }]}
              onPress={() => setRejectOpen(true)}
              disabled={!!busy}
              activeOpacity={0.85}
            >
              <Text style={styles.verdictRejectText}>✕ {t('intl.proof.rejectCta')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.terminalLine}>{t('intl.proof.waitingVerdict')}</Text>
        )}

        {/* Reject reason modal - mandatory, 1–200 chars. */}
        <Modal visible={rejectOpen} animationType="slide" transparent onRequestClose={() => setRejectOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setRejectOpen(false)} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{t('intl.proof.rejectModalTitle')}</Text>
            <Text style={styles.modalHint}>{t('intl.proof.rejectModalHint', { count: attemptsLeft })}</Text>
            <TextInput
              style={styles.reasonInput}
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder={t('intl.proof.reasonPlaceholder')}
              placeholderTextColor={Colors.muted2}
              maxLength={200}
              multiline
              autoFocus
            />
            <Text style={styles.charCount}>{rejectReason.length} / 200</Text>
            <TouchableOpacity
              style={[styles.modalSubmit, (!rejectReason.trim() || busy === 'reject') && { opacity: 0.5 }]}
              onPress={handleReject}
              disabled={!rejectReason.trim() || busy === 'reject'}
              activeOpacity={0.85}
            >
              {busy === 'reject'
                ? <ActivityIndicator color={Colors.white} />
                : <Text style={styles.modalSubmitText}>{t('intl.proof.rejectConfirm')}</Text>}
            </TouchableOpacity>
          </View>
        </Modal>
      </View>
    );
  }

  // Acceptor's actionable state: a fresh acceptance (no proof yet) or a
  // non-final rejection (attempts left). Render a DEDICATED submit/retry
  // button - the single source of truth for triggering the camera. This used
  // to be a tap on the whole pipeline timeline via an imperative ref, which
  // (a) read as pressing the entire step row and (b) silently no-op'd when the
  // ref wasn't attached. A real button removes both problems.
  const lastRejected = latest?.status === 'rejected' ? latest : null;
  if (!iAmAcceptor) return null;
  const canRetry = !!lastRejected && !isFinal;
  const canSubmit = !latest || canRetry;  // fresh OR a non-final rejection
  if (!canSubmit) return null;
  return (
    <View style={styles.card}>
      {lastRejected ? (
        <Text style={styles.reasonLine} numberOfLines={3}>
          {t('intl.proof.lastReason', { reason: lastRejected.rejection_reason ?? '' })}
        </Text>
      ) : null}

      <TouchableOpacity
        style={[styles.submitBtn, busy === 'submit' && { opacity: 0.6 }]}
        onPress={handleSubmit}
        disabled={busy === 'submit'}
        activeOpacity={0.85}
      >
        {busy === 'submit'
          ? <ActivityIndicator color={Colors.white} />
          : (
            <Text style={styles.submitBtnText}>
              📸 {canRetry ? t('intl.proof.tryAgainCta', { count: attemptsLeft }) : t('intl.proof.submitCta')}
            </Text>
          )}
      </TouchableOpacity>

      {/* Android in-app camera (bypasses the hanging launchCameraAsync). */}
      {Platform.OS === 'android' && (
        <AndroidCameraCapture
          visible={androidCamera}
          onCapture={(uri) => { setAndroidCamera(false); submitWithUri(uri, 'image/jpeg'); }}
          onClose={() => setAndroidCamera(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    margin:           Spacing.md,
    padding:          Spacing.md,
    borderRadius:     Radius.lg,
    backgroundColor:  Colors.bg2,
    borderWidth:      1,
    borderColor:      'rgba(255,255,255,0.06)',
    gap:              Spacing.sm,
  },
  reqsBlock: {
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(255,122,60,0.5)',
    paddingLeft:     Spacing.sm,
    gap:             2,
  },
  reqsLabel: { fontSize: FontSizes.xs, fontWeight: '700', color: '#FF7A3C', letterSpacing: 0.6, textTransform: 'uppercase' },
  reqsText:  { fontSize: FontSizes.sm, color: Colors.text, lineHeight: 18 },

  media: { width: '100%', aspectRatio: 4/3, borderRadius: Radius.md, backgroundColor: '#000' },


  verdictRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: 4 },
  verdictBtn: { flex: 1, paddingVertical: Spacing.sm + 2, borderRadius: Radius.full, alignItems: 'center' },
  verdictApprove: { backgroundColor: '#22c55e' },
  verdictReject:  { borderWidth: 1, borderColor: 'rgba(239,68,68,0.5)', backgroundColor: 'rgba(239,68,68,0.08)' },
  verdictApproveText: { color: Colors.white, fontWeight: '800', fontSize: FontSizes.sm },
  verdictRejectText:  { color: '#ef4444', fontWeight: '800', fontSize: FontSizes.sm },

  submitBtn: {
    backgroundColor: '#FF7A3C',
    paddingVertical: Spacing.md,
    borderRadius:    Radius.full,
    alignItems:      'center',
    marginTop:       Spacing.xs,
  },
  submitBtnText: { color: Colors.white, fontWeight: '800', fontSize: FontSizes.md },

  terminalLine: { fontSize: FontSizes.sm, fontWeight: '700', color: Colors.text, textAlign: 'center', paddingVertical: 4 },
  reasonLine:   { fontSize: FontSizes.sm, color: Colors.muted, lineHeight: 18 },
  // Inline-rendered proof requirements (no popin, no separate button).
  // The pipeline carries the "Submit your proof →" CTA; this just reminds
  // the acceptor what the creator asked for.
  requirementsLine: {
    fontSize:   FontSizes.sm,
    color:      Colors.text,
    lineHeight: 18,
    marginTop:  Spacing.xs,
  },
  // Inline submitting indicator - replaces the old big-button spinner.
  busyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: Spacing.sm,
  },
  busyText: { fontSize: FontSizes.sm, color: Colors.muted },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  modalSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: Colors.bg2,
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    padding: Spacing.md, paddingBottom: Spacing.xl, gap: Spacing.sm,
  },
  modalHandle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: Spacing.sm,
  },
  modalTitle: { fontSize: FontSizes.lg, fontWeight: '800', color: Colors.text },
  modalHint:  { fontSize: FontSizes.sm, color: Colors.muted },
  reasonInput: {
    minHeight:         96,
    textAlignVertical: 'top',
    backgroundColor:   'rgba(255,255,255,0.04)',
    borderWidth:       1,
    borderColor:       Colors.border,
    borderRadius:      Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.sm,
    fontSize:          FontSizes.md,
    color:             Colors.text,
  },
  charCount: { fontSize: 11, color: Colors.muted2, textAlign: 'right' },
  modalSubmit: {
    backgroundColor: '#ef4444',
    paddingVertical: Spacing.md,
    borderRadius:    Radius.full,
    alignItems:      'center',
    marginTop:       Spacing.xs,
  },
  modalSubmitText: { color: Colors.white, fontWeight: '800', fontSize: FontSizes.md },
});
