/**
 * ShareSheet — native bottom sheet for share actions in chat composers.
 *
 * Actions:
 *   📸 Snap the vibe     → onSnap() — parent triggers image/camera picker
 *   📍 Drop where you at → onSpot() — parent handles geolocation + send
 */

import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, TouchableWithoutFeedback,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { Colors, FontSizes, Radius } from '@/constants';

interface Props {
  visible:     boolean;
  onSnap:      () => void;
  onSpot:      () => void;
  onClose:     () => void;
  spotLoading: boolean;
}

export function ShareSheet({ visible, onSnap, onSpot, onClose, spotLoading }: Props) {
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
        <Text style={styles.title}>Share something 👀</Text>

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
              <Text style={styles.actionLabel}>Snap a photo</Text>
              <Text style={styles.actionDesc}>Take or upload a photo</Text>
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
              ? <ActivityIndicator size="small" color={Colors.accent} style={styles.actionSpinner} />
              : <Text style={styles.actionIcon}>📍</Text>
            }
            <View style={styles.actionBody}>
              <Text style={styles.actionLabel}>Drop your spot</Text>
              <Text style={styles.actionDesc}>
                {spotLoading ? 'Getting your location…' : 'Share your current spot'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.cancel} onPress={onClose} activeOpacity={0.7}>
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
    paddingHorizontal: 16,
    paddingTop:        20,
    paddingBottom:     36,
    gap:               10,
  },
  title: {
    fontSize:    13,
    fontWeight:  '600',
    color:       Colors.muted2,
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
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.07)',
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
    color:      Colors.text,
  },
  actionDesc: {
    fontSize: FontSizes.xs,
    color:    Colors.muted2,
  },
  cancel: {
    marginTop:       4,
    padding:         14,
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.07)',
    borderRadius:    14,
    alignItems:      'center',
  },
  cancelText: {
    fontSize:   FontSizes.md,
    fontWeight: '600',
    color:      Colors.muted2,
  },
});
