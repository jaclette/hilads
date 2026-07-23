/**
 * ReportModal - lightweight report sheet for registered and ghost user profiles.
 *
 * Shown by a discreet "Report" link on user/guest profile screens.
 * Validates reason length (min 10 chars) before submitting.
 */

import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  TouchableWithoutFeedback, ActivityIndicator, StyleSheet, Alert,
} from 'react-native';
import { submitReport, DuplicateReportError } from '@/api/reports';
import { formatDateLabel } from '@/lib/messageTime';
import { type ThemeColors } from '@/constants';
import { useThemedStyles } from '@/context/ThemeContext';

interface Props {
  visible:         boolean;
  reporterGuestId?: string | null;
  targetUserId?:   string | null;
  targetGuestId?:  string | null;
  targetNickname?: string | null;
  onClose:         () => void;
}

export function ReportModal({ visible, reporterGuestId, targetUserId, targetGuestId, targetNickname, onClose }: Props) {
  const styles = useThemedStyles(makeStyles);
  const [reason,  setReason]  = useState('');
  const [loading, setLoading] = useState(false);

  const canSubmit = reason.trim().length >= 10 && !loading;

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    try {
      await submitReport({
        reason: reason.trim(),
        guestId: reporterGuestId,
        targetUserId,
        targetGuestId,
        targetNickname,
      });
      setReason('');
      onClose();
      Alert.alert('Report sent', 'Thanks for letting us know. Our team will review it.');
    } catch (err: any) {
      if (err instanceof DuplicateReportError) {
        const when = formatDateLabel(err.existing.created_at);
        setReason('');
        onClose();
        Alert.alert(
          'Already reported',
          `You reported this user on ${when}. Your report is being reviewed.`,
        );
      } else {
        Alert.alert('Error', err?.message ?? 'Could not send report. Try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    if (loading) return;
    setReason('');
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      <View style={styles.sheet}>
        <Text style={styles.title}>Report user</Text>
        <Text style={styles.subtitle}>
          Tell us what's wrong with {targetNickname ? `@${targetNickname}` : 'this user'}.
          Reports are anonymous.
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Describe the issue (min 10 characters)…"
          placeholderTextColor="rgba(128,128,128,0.7)"
          value={reason}
          onChangeText={setReason}
          multiline
          maxLength={500}
          editable={!loading}
          returnKeyType="default"
          textAlignVertical="top"
        />
        <Text style={styles.charCount}>{reason.trim().length} / 500</Text>

        <TouchableOpacity
          style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.submitText}>Send report</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelBtn} onPress={handleClose} disabled={loading} activeOpacity={0.7}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  overlay: {
    flex:            1,
    backgroundColor: c.scrim,
  },
  sheet: {
    backgroundColor:   c.elevated,
    borderTopWidth:    1,
    borderTopColor:    c.separator,
    borderRadius:      20,
    paddingHorizontal: 20,
    paddingTop:        24,
    paddingBottom:     40,
    gap:               12,
  },
  title: {
    fontSize:   18,
    fontWeight: '700',
    color:      c.text,
  },
  subtitle: {
    fontSize:  13,
    color:     c.muted,
    lineHeight: 18,
  },
  input: {
    backgroundColor: c.overlay,
    borderWidth:     1,
    borderColor:     c.separator,
    borderRadius:    10,
    padding:         12,
    color:           c.text,
    fontSize:        14,
    minHeight:       100,
    marginTop:       4,
  },
  charCount: {
    fontSize:  11,
    color:     c.mutedDim,
    textAlign: 'right',
    marginTop: -6,
  },
  submitBtn: {
    backgroundColor: c.accent,
    borderRadius:    12,
    paddingVertical: 14,
    alignItems:      'center',
    marginTop:       4,
  },
  submitBtnDisabled: {
    opacity: 0.4,
  },
  submitText: {
    fontSize:   16,
    fontWeight: '600',
    color:      '#fff',
  },
  cancelBtn: {
    alignItems:      'center',
    paddingVertical: 10,
  },
  cancelText: {
    fontSize: 15,
    color:    c.muted,
  },
});
