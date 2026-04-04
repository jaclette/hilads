import { useRef, useEffect } from 'react';
import {
  Modal, View, Image, TouchableOpacity, Text, StyleSheet,
  Dimensions, StatusBar, PanResponder, Animated,
} from 'react-native';

const { width: SW, height: SH } = Dimensions.get('window');

interface Props {
  uri: string | null;
  onClose: () => void;
}

export function ImagePreviewModal({ uri, onClose }: Props) {
  const translateY = useRef(new Animated.Value(0)).current;
  const bgOpacity  = useRef(new Animated.Value(1)).current;

  // Reset position whenever a new image opens
  useEffect(() => {
    if (uri) {
      translateY.setValue(0);
      bgOpacity.setValue(1);
    }
  }, [uri]);

  const panResponder = useRef(
    PanResponder.create({
      // Let the initial touch fall through to TouchableOpacity (so tap-to-close works).
      // Only claim the gesture once the user actually moves downward.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder:  (_, g) =>
        Math.abs(g.dy) > Math.abs(g.dx) && g.dy > 4,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) {
          translateY.setValue(g.dy);
          bgOpacity.setValue(Math.max(0, 1 - g.dy / 280));
        }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 90 || g.vy > 1.0) {
          // Swipe past threshold — animate out then close
          Animated.parallel([
            Animated.timing(translateY, { toValue: SH, duration: 180, useNativeDriver: true }),
            Animated.timing(bgOpacity,  { toValue: 0,  duration: 180, useNativeDriver: true }),
          ]).start(() => {
            translateY.setValue(0);
            bgOpacity.setValue(1);
            onClose();
          });
        } else {
          // Below threshold — snap back
          Animated.parallel([
            Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
            Animated.spring(bgOpacity,  { toValue: 1, useNativeDriver: true }),
          ]).start();
        }
      },
    }),
  ).current;

  return (
    <Modal
      visible={!!uri}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar hidden />
      <Animated.View style={[styles.backdrop, { opacity: bgOpacity }]}>

        {/* Full-screen tap area — tap anywhere to close */}
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          activeOpacity={1}
        />

        {/* Image — drag down to dismiss */}
        <Animated.View
          style={[styles.imageWrap, { transform: [{ translateY }] }]}
          {...panResponder.panHandlers}
        >
          {uri && (
            <Image
              source={{ uri }}
              style={styles.image}
              resizeMode="contain"
            />
          )}
        </Animated.View>

        {/* Close button */}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.75}>
          <Text style={styles.closeIcon}>✕</Text>
        </TouchableOpacity>

      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageWrap: {
    width:           SW,
    height:          SH,
    justifyContent:  'center',
    alignItems:      'center',
  },
  image: {
    width:  SW,
    height: SH,
  },
  closeBtn: {
    position:        'absolute',
    top:             52,
    right:           20,
    width:           36,
    height:          36,
    borderRadius:    18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent:  'center',
    alignItems:      'center',
  },
  closeIcon: {
    color:      '#fff',
    fontSize:   15,
    fontWeight: '700',
  },
});
