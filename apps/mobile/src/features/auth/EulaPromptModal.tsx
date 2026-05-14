/**
 * EulaPromptModal — Apple Guideline 1.2 EULA gate.
 *
 * Shown to users who haven't accepted the Terms / EULA yet:
 *   - At signup: rendered inline as a checkbox + zero-tolerance copy.
 *   - On launch: blocking modal for existing users (registered before the
 *     moderation update shipped).
 *
 * The shared body / copy / links live in this component so the two surfaces
 * stay in sync.
 */

import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, Linking, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSizes, Radius, Spacing } from '@/constants';

const TERMS_URL   = 'https://hilads.live/terms';
const PRIVACY_URL = 'https://hilads.live/privacy';

/**
 * Hilads' zero-tolerance line — literal copy required to be visible on the
 * EULA gate. Apple G1.2 calls this out as mandatory verbiage.
 */
export const ZERO_TOLERANCE_COPY =
  'Hilads has zero tolerance for objectionable content or abusive behavior. ' +
  'Violations may result in immediate account termination.';

// ── Reusable block: zero-tolerance text + ToS / Privacy links ─────────────────

export function EulaCopyBlock() {
  return (
    <View style={styles.copyBlock}>
      <Text style={styles.zeroTolerance}>{ZERO_TOLERANCE_COPY}</Text>
      <Text style={styles.linksRow}>
        Read our{' '}
        <Text style={styles.link} onPress={() => Linking.openURL(TERMS_URL)}>
          Terms of Service
        </Text>
        {' '}and{' '}
        <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_URL)}>
          Privacy Policy
        </Text>
        .
      </Text>
    </View>
  );
}

// ── Inline checkbox (used at signup) ──────────────────────────────────────────

interface CheckboxProps {
  checked:    boolean;
  onToggle:   () => void;
  disabled?:  boolean;
}

export function EulaCheckbox({ checked, onToggle, disabled }: CheckboxProps) {
  return (
    <TouchableOpacity
      style={styles.checkboxRow}
      onPress={onToggle}
      activeOpacity={0.7}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked
          ? <Ionicons name="checkmark" size={14} color="#fff" />
          : null
        }
      </View>
      <Text style={styles.checkboxLabel}>
        I agree to the{' '}
        <Text style={styles.link} onPress={() => Linking.openURL(TERMS_URL)}>
          Terms of Service
        </Text>
        {' '}and{' '}
        <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_URL)}>
          Privacy Policy
        </Text>
        .
      </Text>
    </TouchableOpacity>
  );
}

// ── Boot-time re-prompt modal (used in _layout) ───────────────────────────────

interface ModalProps {
  visible:  boolean;
  loading?: boolean;
  onAccept: () => void;
}

export function EulaPromptModal({ visible, loading, onAccept }: ModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => { /* not dismissable — must accept */ }}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Updated Terms</Text>
          <Text style={styles.modalSub}>
            Hilads' Terms of Service and Community Guidelines have been updated.
            Please review and accept to continue.
          </Text>

          <EulaCopyBlock />

          <TouchableOpacity
            style={[styles.acceptBtn, loading && styles.acceptBtnDisabled]}
            onPress={onAccept}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.acceptBtnText}>I agree</Text>
            }
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Shared copy block
  copyBlock: {
    gap: Spacing.xs,
  },
  zeroTolerance: {
    fontSize:   FontSizes.sm,
    fontWeight: '600',
    color:      Colors.text,
    lineHeight: 20,
  },
  linksRow: {
    fontSize:   FontSizes.sm,
    color:      Colors.muted,
    lineHeight: 20,
  },
  link: {
    color:               Colors.accent,
    textDecorationLine:  'underline',
    fontWeight:          '600',
  },

  // Checkbox (inline at signup)
  checkboxRow: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  checkbox: {
    width:           22,
    height:          22,
    borderRadius:    Radius.sm,
    borderWidth:     2,
    borderColor:     Colors.muted,
    alignItems:      'center',
    justifyContent:  'center',
    marginTop:       1,
    flexShrink:      0,
  },
  checkboxChecked: {
    borderColor:     Colors.accent,
    backgroundColor: Colors.accent,
  },
  checkboxLabel: {
    flex:       1,
    fontSize:   FontSizes.sm,
    color:      Colors.text,
    lineHeight: 20,
  },

  // Re-prompt modal
  modalOverlay: {
    flex:              1,
    backgroundColor:   'rgba(0,0,0,0.75)',
    paddingHorizontal: Spacing.lg,
    alignItems:        'center',
    justifyContent:    'center',
  },
  modalCard: {
    width:           '100%',
    maxWidth:        420,
    backgroundColor: Colors.bg2,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
    padding:         Spacing.lg,
    gap:             Spacing.md,
  },
  modalTitle: {
    fontSize:      FontSizes.xl,
    fontWeight:    '800',
    color:         Colors.text,
    letterSpacing: -0.3,
  },
  modalSub: {
    fontSize:   FontSizes.sm,
    color:      Colors.muted,
    lineHeight: 20,
  },
  acceptBtn: {
    backgroundColor: Colors.accent,
    borderRadius:    Radius.md,
    paddingVertical: Spacing.md,
    alignItems:      'center',
    justifyContent:  'center',
    marginTop:       Spacing.sm,
  },
  acceptBtnDisabled: {
    opacity: 0.6,
  },
  acceptBtnText: {
    color:      '#fff',
    fontSize:   FontSizes.md,
    fontWeight: '700',
    lineHeight: FontSizes.md * 1.25,
  },
});
