import { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors, FontSizes, Radius, Spacing } from '@/constants';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelectChallenge: () => void;
  onSelectEvent: () => void;
  onSelectTopic: () => void;
}

export function CreateSheet({ visible, onClose, onSelectChallenge, onSelectEvent, onSelectTopic }: Props) {
  const { t } = useTranslation('now');
  const slideAnim   = useRef(new Animated.Value(300)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue:         0,
          damping:         22,
          stiffness:       260,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue:         1,
          duration:        200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue:         300,
          duration:        200,
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue:         0,
          duration:        180,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  function handleOption(fn: () => void) {
    onClose();
    // Small delay so the sheet closes before navigation
    setTimeout(fn, 150);
  }

  return (
    <Modal transparent visible={visible} onRequestClose={onClose} statusBarTranslucent>
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, { opacity: backdropAnim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
        {/* Handle */}
        <View style={styles.handle} />

        {/* Title */}
        <Text style={styles.title}>{t('create.title')}</Text>

        {/* Options - order: Challenge (new core feature, top) → Hangout (instant)
            → Event (planned). Challenge is placed first per the product spec
            (it's now the primary creation flow connecting locals & explorers).
            Internal handlers: onSelectChallenge → challenge create,
            onSelectTopic → hangout create, onSelectEvent → event create. */}
        <View style={styles.options}>
          <TouchableOpacity
            style={styles.option}
            activeOpacity={0.75}
            onPress={() => handleOption(onSelectChallenge)}
          >
            <View style={styles.optionIcon}>
              <Text style={styles.optionEmoji}>🔥</Text>
            </View>
            <View style={styles.optionBody}>
              <Text style={styles.optionLabel}>{t('create.challengeLabel')}</Text>
              <Text style={styles.optionSub}>{t('create.challengeSub')}</Text>
            </View>
            <Text style={styles.optionArrow}>›</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.option}
            activeOpacity={0.75}
            onPress={() => handleOption(onSelectTopic)}
          >
            <View style={styles.optionIcon}>
              <Text style={styles.optionEmoji}>🗣️</Text>
            </View>
            <View style={styles.optionBody}>
              <Text style={styles.optionLabel}>{t('create.hangoutLabel')}</Text>
              <Text style={styles.optionSub}>{t('create.hangoutSub')}</Text>
            </View>
            <Text style={styles.optionArrow}>›</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.option}
            activeOpacity={0.75}
            onPress={() => handleOption(onSelectEvent)}
          >
            <View style={styles.optionIcon}>
              <Text style={styles.optionEmoji}>🎉</Text>
            </View>
            <View style={styles.optionBody}>
              <Text style={styles.optionLabel}>{t('create.eventLabel')}</Text>
              <Text style={styles.optionSub}>{t('create.eventSub')}</Text>
            </View>
            <Text style={styles.optionArrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Cancel */}
        <TouchableOpacity style={styles.cancel} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.cancelText}>{t('create.cancel')}</Text>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },

  sheet: {
    position:        'absolute',
    bottom:          0,
    left:            0,
    right:           0,
    backgroundColor: Colors.bg2,
    borderTopLeftRadius:  24,
    borderTopRightRadius: 24,
    borderWidth:     1,
    borderColor:     Colors.border,
    paddingBottom:   36,
    paddingTop:      12,
  },

  handle: {
    alignSelf:       'center',
    width:           40,
    height:          4,
    borderRadius:    2,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginBottom:    20,
  },

  title: {
    fontSize:      FontSizes.xl,
    fontWeight:    '800',
    color:         Colors.text,
    textAlign:     'center',
    marginBottom:  Spacing.md,
    letterSpacing: -0.5,
  },

  options: {
    marginHorizontal: Spacing.md,
    backgroundColor:  Colors.bg3,
    borderRadius:     Radius.lg,
    borderWidth:      1,
    borderColor:      Colors.border,
    overflow:         'hidden',
  },

  option: {
    flexDirection:     'row',
    alignItems:        'center',
    paddingVertical:   Spacing.md,
    paddingHorizontal: Spacing.md,
    gap:               Spacing.sm,
  },

  // Bare icon slot - emoji renders on its own. We used to tint the box with
  // category colors (orange / blue / orange-stronger), but only the strongest
  // tint was visible against the warm-dark surface, which made challenge look
  // like the odd one out with a brown box. Cleaner to drop the tint for all
  // three so the emojis read consistently.
  optionIcon: {
    width:          50,
    height:         50,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },

  optionEmoji: {
    fontSize: 24,
    lineHeight: 28,
  },

  optionBody: {
    flex: 1,
    gap:  3,
  },

  optionLabel: {
    fontSize:   FontSizes.md,
    fontWeight: '700',
    color:      Colors.text,
  },

  optionSub: {
    fontSize: FontSizes.sm,
    color:    Colors.muted,
  },

  optionArrow: {
    fontSize:   22,
    color:      Colors.muted2,
    fontWeight: '300',
    lineHeight: 28,
  },

  divider: {
    height:          1,
    backgroundColor: Colors.border,
    marginHorizontal: Spacing.md,
  },

  cancel: {
    marginTop:         Spacing.md,
    marginHorizontal:  Spacing.md,
    paddingVertical:   Spacing.sm + 2,
    borderRadius:      Radius.lg,
    backgroundColor:   Colors.bg3,
    borderWidth:       1,
    borderColor:       Colors.border,
    alignItems:        'center',
  },

  cancelText: {
    fontSize:   FontSizes.sm,
    fontWeight: '600',
    color:      Colors.muted,
  },
});
