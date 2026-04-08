/**
 * ReportModal — lightweight report sheet for registered and ghost user profiles.
 *
 * Shown by a discreet "Report" link on user/guest profile screens.
 * Validates reason length (min 10 chars) before submitting.
 */

import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  TouchableWithoutFeedback, ActivityIndicator, StyleSheet, Alert,
} from 'react-native';
import { submitReport } from '@/api/reports';

interface Props {
  visible:         boolean;
  reporterGuestId?: string | null;
  targetUserId?:   string | null;
  targetGuestId?:  string | null;
  targetNickname?: string | null;
  onClose:         () => void;
}

export function ReportModal({ visible, reporterGuestId, targetUserId, targetGuestId, targetNickname, onClose }: Props) {
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
      Alert.alert('Error', err?.message ?? 'Could not send report. Try again.');
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
          placeholderTextColor="rgba(255,255,255,0.25)"
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

const styles = StyleSheet.create({
  overlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor:   '#1a1512',
    borderTopWidth:    1,
    borderTopColor:    'rgba(255,255,255,0.08)',
    borderRadius:      20,
    paddingHorizontal: 20,
    paddingTop:        24,
    paddingBottom:     40,
    gap:               12,
  },
  title: {
    fontSize:   18,
    fontWeight: '700',
    color:      '#fff',
  },
  subtitle: {
    fontSize:  13,
    color:     'rgba(255,255,255,0.45)',
    lineHeight: 18,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.1)',
    borderRadius:    10,
    padding:         12,
    color:           '#fff',
    fontSize:        14,
    minHeight:       100,
    marginTop:       4,
  },
  charCount: {
    fontSize:  11,
    color:     'rgba(255,255,255,0.25)',
    textAlign: 'right',
    marginTop: -6,
  },
  submitBtn: {
    backgroundColor: '#FF7A3C',
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
    color:    'rgba(255,255,255,0.4)',
  },
});
