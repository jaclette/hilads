/**
 * ShareSheet - native bottom sheet for share actions in chat composers.
 *
 * Actions:
 *   📸 Snap the vibe     → onSnap() - parent triggers image/camera picker
 *   📍 Drop where you at → onSpot() - parent handles geolocation + send
 */

import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, TouchableWithoutFeedback,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { FontSizes, Radius, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';

interface Props {
  visible:     boolean;
  onSnap:      () => void;
  onSpot:      () => void;
  onClose:     () => void;
  spotLoading: boolean;
}

export function ShareSheet({ visible, onSnap, onSpot, onClose, spotLoading }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();

  const { t } = useTranslation('common');
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      <View style={styles.sheet}>
        <Text style={styles.title}>{t('share.title')}</Text>

        <View style={styles.actions}>
          {/* Snap the vibe */}
          <TouchableOpacity
            style={styles.action}
            onPress={onSnap}
            activeOpacity={0.75}
            disabled={spotLoading}
          >
            <Text style={styles.actionIcon}>📸</Text>
            <View style={styles.actionBody}>
              <Text style={styles.actionLabel}>{t('share.snap')}</Text>
              <Text style={styles.actionDesc}>{t('share.snapDesc')}</Text>
            </View>
          </TouchableOpacity>

          {/* Drop where you at */}
          <TouchableOpacity
            style={styles.action}
            onPress={onSpot}
            activeOpacity={0.75}
            disabled={spotLoading}
          >
            {spotLoading
              ? <ActivityIndicator size="small" color={colors.accent} style={styles.actionSpinner} />
              : <Text style={styles.actionIcon}>📍</Text>
            }
            <View style={styles.actionBody}>
              <Text style={styles.actionLabel}>{t('share.spot')}</Text>
              <Text style={styles.actionDesc}>
                {spotLoading ? t('share.spotLoading') : t('share.spotDesc')}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.cancel} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.cancelText}>{t('cancel')}</Text>
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
    backgroundColor:   c.bg2,
    borderTopWidth:    1,
    borderTopColor:    c.border,
    borderRadius:      20,
    paddingHorizontal: 16,
    paddingTop:        20,
    paddingBottom:     36,
    gap:               10,
  },
  title: {
    fontSize:    13,
    fontWeight:  '600',
    color:       c.muted2,
    textAlign:   'center',
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  actions: {
    gap: 10,
  },
  action: {
    flexDirection:   'row',
    alignItems:      'center',
    gap:             16,
    padding:         16,
    backgroundColor: c.overlayWeak,
    borderWidth:     1,
    borderColor:     c.overlay,
    borderRadius:    16,
  },
  actionIcon: {
    fontSize:  28,
    width:     36,
    textAlign: 'center',
  },
  actionSpinner: {
    width:  36,
    height: 36,
  },
  actionBody: {
    flex: 1,
    gap:  3,
  },
  actionLabel: {
    fontSize:   FontSizes.md,
    fontWeight: '700',
    color:      c.text,
  },
  actionDesc: {
    fontSize: FontSizes.xs,
    color:    c.muted2,
  },
  cancel: {
    marginTop:       4,
    padding:         14,
    borderWidth:     1,
    borderColor:     c.overlay,
    borderRadius:    14,
    alignItems:      'center',
  },
  cancelText: {
    fontSize:   FontSizes.md,
    fontWeight: '600',
    color:      c.muted2,
  },
});
