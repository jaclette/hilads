import { useRef, useEffect, useState } from 'react';
import {
  Modal, View, Image, TouchableOpacity, Text, StyleSheet,
  Dimensions, StatusBar, PanResponder, Animated, Alert, Platform, Linking,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SW, height: SH } = Dimensions.get('window');

interface Props {
  uri: string | null;
  onClose: () => void;
}

// ── Local cache helpers ──────────────────────────────────────────────────────
// Both Download and Share need the image as a local FILE - Sharing.shareAsync
// won't take a remote URL on iOS, and MediaLibrary.saveToLibraryAsync wants a
// file:// path. We download once into the cache directory and reuse for both
// actions, keyed by the last segment of the URL so repeated taps don't refetch.

function cacheFilenameFor(remoteUrl: string): string {
  // R2 URLs end in /<uuid>.<ext>. Strip query, take the basename, sanitize.
  const noQuery = remoteUrl.split('?')[0] ?? remoteUrl;
  const segs = noQuery.split('/');
  const last = segs[segs.length - 1] || 'image.jpg';
  return last.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function ensureLocalCopy(remoteUrl: string): Promise<string> {
  const dest = `${FileSystem.cacheDirectory}${cacheFilenameFor(remoteUrl)}`;
  const info = await FileSystem.getInfoAsync(dest);
  if (info.exists && info.size > 0) return dest;
  const result = await FileSystem.downloadAsync(remoteUrl, dest);
  return result.uri;
}

export function ImagePreviewModal({ uri, onClose }: Props) {
  const { t } = useTranslation('chat');
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(0)).current;
  const bgOpacity  = useRef(new Animated.Value(1)).current;
  const [busy, setBusy] = useState<'download' | 'share' | null>(null);

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
          // Swipe past threshold - animate out then close
          Animated.parallel([
            Animated.timing(translateY, { toValue: SH, duration: 180, useNativeDriver: true }),
            Animated.timing(bgOpacity,  { toValue: 0,  duration: 180, useNativeDriver: true }),
          ]).start(() => {
            translateY.setValue(0);
            bgOpacity.setValue(1);
            onClose();
          });
        } else {
          // Below threshold - snap back
          Animated.parallel([
            Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }),
            Animated.spring(bgOpacity,  { toValue: 1, useNativeDriver: true }),
          ]).start();
        }
      },
    }),
  ).current;

  // ── Download - save to camera roll / Photos library ──────────────────────
  async function handleDownload() {
    if (!uri || busy) return;
    setBusy('download');
    try {
      // Permission flow: iOS requires WRITE access (NSPhotoLibraryAddUsageDescription).
      // Android 10+ doesn't need a runtime permission for saveToLibraryAsync into
      // shared storage, but expo-media-library still requests it on older versions.
      const perm = await MediaLibrary.requestPermissionsAsync(false /* writeOnly */);
      if (!perm.granted) {
        if (perm.canAskAgain === false) {
          Alert.alert(
            t('photoSavePermTitle', { defaultValue: 'Photo access needed' }),
            t('photoSavePermSettings', { defaultValue: 'Allow photo access in Settings to save images.' }),
            [
              { text: t('actionCancel'), style: 'cancel' },
              { text: t('openSettings', { ns: 'common', defaultValue: 'Open Settings' }), onPress: () => Linking.openSettings() },
            ],
          );
        } else {
          Alert.alert(t('photoSavePermTitle', { defaultValue: 'Photo access needed' }), t('photoSavePermBody', { defaultValue: 'Allow photo access to save images.' }));
        }
        return;
      }
      const local = await ensureLocalCopy(uri);
      await MediaLibrary.saveToLibraryAsync(local);
      Alert.alert(t('downloadSuccess', { defaultValue: 'Saved to Photos' }));
    } catch (e) {
      console.warn('[image-preview] download failed:', e);
      Alert.alert(t('downloadFailed', { defaultValue: "Couldn't save the photo" }));
    } finally {
      setBusy(null);
    }
  }

  // ── Share - open the native share sheet with the image attached ──────────
  async function handleShare() {
    if (!uri || busy) return;
    setBusy('share');
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) {
        Alert.alert(t('shareUnavailable', { defaultValue: 'Sharing isn’t available on this device' }));
        return;
      }
      const local = await ensureLocalCopy(uri);
      // dialogTitle is Android-only; iOS uses the system share sheet header.
      await Sharing.shareAsync(local, {
        mimeType: 'image/jpeg',
        dialogTitle: t('shareDialogTitle', { defaultValue: 'Share photo' }),
        UTI: 'public.image',
      });
    } catch (e) {
      console.warn('[image-preview] share failed:', e);
      Alert.alert(t('shareFailed', { defaultValue: "Couldn't share the photo" }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      visible={!!uri}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <StatusBar hidden />
      <View style={styles.backdrop}>

        {/* Dark backdrop - fades during swipe-to-dismiss. Kept separate from
            the action bar so the buttons stay fully opaque even mid-gesture. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.backdropFill, { opacity: bgOpacity }]}
          pointerEvents="none"
        />

        {/* Full-screen tap area - tap anywhere to close */}
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          activeOpacity={1}
        />

        {/* Image - drag down to dismiss. Also fades with bgOpacity so the
            image follows the dismiss gesture visually. */}
        <Animated.View
          style={[styles.imageWrap, { transform: [{ translateY }], opacity: bgOpacity }]}
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

        {/* Close button (top-right) - safe-area aware so it never lands under
            the notch / status bar area. */}
        <TouchableOpacity
          style={[styles.closeBtn, { top: Math.max(insets.top + 8, 28) }]}
          onPress={onClose}
          activeOpacity={0.75}
        >
          <Text style={styles.closeIcon}>✕</Text>
        </TouchableOpacity>

        {/* Action bar - bottom of the lightbox. Two thumb-friendly pill
            buttons. Bottom inset keeps them above the Android nav bar /
            iOS home indicator on every device. */}
        <View
          style={[styles.actionBar, { bottom: Math.max(insets.bottom + 12, Platform.OS === 'ios' ? 38 : 24) }]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            style={[styles.actionBtn, busy === 'download' && styles.actionBtnBusy]}
            onPress={handleDownload}
            disabled={!!busy}
            activeOpacity={0.8}
          >
            <Text style={styles.actionIcon}>⬇</Text>
            <Text style={styles.actionLabel}>{t('actionDownload', { defaultValue: 'Save' })}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, busy === 'share' && styles.actionBtnBusy]}
            onPress={handleShare}
            disabled={!!busy}
            activeOpacity={0.8}
          >
            <Text style={styles.actionIcon}>↗</Text>
            <Text style={styles.actionLabel}>{t('actionShare', { defaultValue: 'Share' })}</Text>
          </TouchableOpacity>
        </View>

      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdropFill: {
    backgroundColor: 'rgba(0,0,0,0.95)',
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
  actionBar: {
    position:       'absolute',
    left:           0,
    right:          0,
    flexDirection:  'row',
    justifyContent: 'center',
    gap:            12,
  },
  actionBtn: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               8,
    paddingHorizontal: 18,
    paddingVertical:   11,
    borderRadius:      24,
    backgroundColor:   'rgba(255,255,255,0.15)',
    borderWidth:       1,
    borderColor:       'rgba(255,255,255,0.18)',
  },
  actionBtnBusy: {
    opacity: 0.5,
  },
  actionIcon: {
    color:    '#fff',
    fontSize: 16,
  },
  actionLabel: {
    color:      '#fff',
    fontSize:   15,
    fontWeight: '600',
  },
});
