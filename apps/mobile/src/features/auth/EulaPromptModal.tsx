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
  View, Text, Pressable, TouchableOpacity, Linking, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Trans, useTranslation } from 'react-i18next';
import { Colors, FontSizes, Radius, Spacing } from '@/constants';

const TERMS_URL   = 'https://hilads.live/terms';
const PRIVACY_URL = 'https://hilads.live/privacy';

// ── Reusable block: zero-tolerance text + ToS / Privacy links ─────────────────

export function EulaCopyBlock() {
  const { t } = useTranslation('auth');
  return (
    <View style={styles.copyBlock}>
      <Text style={styles.zeroTolerance}>{t('eula.zeroTolerance')}</Text>
      <Trans
        i18nKey="eula.links"
        ns="auth"
        parent={Text}
        style={styles.linksRow}
        components={{
          terms:   <Text style={styles.link} onPress={() => Linking.openURL(TERMS_URL)} />,
          privacy: <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_URL)} />,
        }}
      />
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
  const { t } = useTranslation('auth');
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
      <Trans
        i18nKey="eula.agree"
        ns="auth"
        parent={Text}
        style={styles.checkboxLabel}
        components={{
          terms:   <Text style={styles.link} onPress={() => Linking.openURL(TERMS_URL)} />,
          privacy: <Text style={styles.link} onPress={() => Linking.openURL(PRIVACY_URL)} />,
        }}
      />
    </TouchableOpacity>
  );
}

// ── Boot-time re-prompt modal (used in _layout) ───────────────────────────────

interface ModalProps {
  visible:  boolean;
  loading?: boolean;
  error?:   string | null;
  onAccept: () => void;
}

export function EulaPromptModal({ visible, loading, error, onAccept }: ModalProps) {
  const { t } = useTranslation('auth');
  // Plain absolutely-positioned overlay rather than React Native's <Modal>.
  // The native <Modal transparent> on iPad in iPhone-compat mode renders in
  // a UIWindow that doesn't extend over the tab bar AND has flaky touch
  // hit-testing on iOS 26. An in-tree overlay sits above everything (it's
  // rendered last in _layout.tsx so it has the highest paint order) and
  // captures touches uniformly across iPad / iPhone.
  if (!visible) return null;
  console.log('[eula] modal visible — rendering overlay (loading=' + String(loading ?? false) + ')');
  return (
    // Pressable absorbs taps on the backdrop so they don't fall through.
    // No onPress — the modal is non-dismissable. We just want guaranteed
    // touch capture across iOS 26 / iPad-compat behaviours that <View> alone
    // doesn't handle reliably.
    <Pressable
      style={styles.modalOverlay}
      onPress={() => { /* swallow backdrop taps */ }}
      accessibilityViewIsModal
    >
      <View style={styles.modalCard}>
        <Text style={styles.modalTitle}>{t('eula.modalTitle')}</Text>
        <Text style={styles.modalSub}>{t('eula.modalSub')}</Text>

        <EulaCopyBlock />

        {/* Failure feedback — without this, a failed/hung accept call leaves
            the user staring at a button that "does nothing". */}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* Pressable instead of TouchableOpacity — RN's newer primitive has
            more reliable hit-testing inside overlays on iOS 26 / iPad. */}
        <Pressable
          style={({ pressed }) => [
            styles.acceptBtn,
            loading && styles.acceptBtnDisabled,
            pressed && !loading && styles.acceptBtnPressed,
          ]}
          onPress={() => {
            console.log('[eula] I agree tapped');
            if (!loading) onAccept();
          }}
          disabled={loading}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('eula.accept')}
        >
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.acceptBtnText}>{t('eula.accept')}</Text>
          }
        </Pressable>
      </View>
    </Pressable>
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

  // Re-prompt overlay — full-screen absolute layer rendered in-tree (no
  // native <Modal>). Lives at the top of the React tree (last sibling in
  // _layout.tsx), so its high zIndex puts it above the bottom tab bar.
  modalOverlay: {
    position:          'absolute',
    top:               0,
    left:              0,
    right:             0,
    bottom:            0,
    backgroundColor:   'rgba(0,0,0,0.85)',
    paddingHorizontal: Spacing.lg,
    alignItems:        'center',
    justifyContent:    'center',
    zIndex:            9999,
    elevation:         9999, // Android paint order
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
  errorText: {
    fontSize:   FontSizes.sm,
    color:      '#ff6b6b',
    lineHeight: 18,
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
  acceptBtnPressed: {
    opacity: 0.85,
  },
  acceptBtnText: {
    color:      '#fff',
    fontSize:   FontSizes.md,
    fontWeight: '700',
    lineHeight: FontSizes.md * 1.25,
  },
});
