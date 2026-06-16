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
  ActivityIndicator, Alert, Modal, TextInput, Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import {
  fetchProofs, submitProof, approveProof, rejectProof,
  type ChallengeProof,
} from '@/api/challenges';
import { uploadFile } from '@/api/uploads';
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
  const handleSubmit = useCallback(async () => {
    if (busy) return;

    // The ENTIRE flow (camera permission + capture + upload + submit) is wrapped
    // so a failure anywhere surfaces as an alert instead of a silent no-op - the
    // camera calls used to sit outside the try, so any throw there (denied perm,
    // camera unavailable, picker error) vanished into an unhandled rejection and
    // the button "did nothing".
    try {
      // 1. CAMERA permission + live capture. PR55 - proof MUST be an
      //    instant photo (no gallery picker): a stock food photo from the
      //    library would break the "I was here right now" contract.
      const cam = await ImagePicker.requestCameraPermissionsAsync();
      if (cam.status !== 'granted') {
        Alert.alert(t('intl.proof.permPhotoTitle'), t('intl.proof.permPhotoBody'));
        return;
      }
      const pick = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality:    0.85,
        // Rear camera - proofs are about the place / dish, not a selfie.
        cameraType: ImagePicker.CameraType.back,
        allowsEditing: false,
      });
      if (pick.canceled || !pick.assets?.[0]) return;
      const asset = pick.assets[0];

      // 2. Upload media → 3. Submit
      setBusy('submit');
      const { url } = await uploadFile(asset.uri, asset.mimeType ?? null);
      await submitProof(acceptanceId, { mediaUrl: url, mediaType: 'image' });
      await load();
    } catch (e) {
      Alert.alert(t('intl.proof.submitFailTitle'), e instanceof Error ? e.message : t('intl.proof.submitFailBody'));
    } finally {
      setBusy(null);
    }
  }, [busy, acceptanceId, load, t]);

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
