/**
 * AndroidCameraCapture - in-app camera modal for Android.
 *
 * Why: expo-image-picker's launchCameraAsync() uses ActivityResultLauncher
 * internally. On Android 14 + singleTask MainActivity the result callback
 * never fires, so the promise hangs until the app is backgrounded/foregrounded.
 *
 * UX flow:
 *   1. Camera viewfinder + floating controls (flip / flash)
 *   2. Tap shutter → capture
 *   3. Preview screen → Retake | Use Photo
 *   4. Use Photo → compress → onCapture(uri)
 */

import { useRef, useState } from 'react';
import {
  Modal, View, TouchableOpacity, ActivityIndicator,
  StyleSheet, SafeAreaView, Text, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Radius, Spacing, type ThemeColors } from '@/constants';
import { useThemedStyles, useTheme } from '@/context/ThemeContext';
import { Button, IconButton } from '@/ui';

// ── Types ─────────────────────────────────────────────────────────────────────

type FlashMode = 'off' | 'on' | 'auto';
type Screen = 'camera' | 'preview';

interface Props {
  visible: boolean;
  onCapture: (uri: string) => void;
  onClose: () => void;
}

// ── Compression settings ──────────────────────────────────────────────────────
// Resize only if the image is very wide (> 1920px) so tiny thumbnails aren't
// re-encoded needlessly. JPEG 0.78 gives a good quality/size balance for chat.
const MAX_WIDTH   = 1920;
const JPEG_QUALITY = 0.78;

// ── Component ─────────────────────────────────────────────────────────────────

export function AndroidCameraCapture({ visible, onCapture, onClose }: Props) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const { t } = useTranslation('common');

  const cameraRef = useRef<CameraView>(null);
  const insets    = useSafeAreaInsets();

  const [screen,      setScreen]      = useState<Screen>('camera');
  const [ready,       setReady]       = useState(false);
  const [taking,      setTaking]      = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [facing,      setFacing]      = useState<'back' | 'front'>('back');
  const [flash,       setFlash]       = useState<FlashMode>('off');
  const [capturedUri, setCapturedUri] = useState<string | null>(null);

  const [permission, requestPermission] = useCameraPermissions();

  // Reset state each time the modal opens
  function handleModalShow() {
    setScreen('camera');
    setReady(false);
    setCapturedUri(null);
    console.log('[android-camera] modal opened');
  }

  // ── Capture ───────────────────────────────────────────────────────────────

  async function takePhoto() {
    if (!cameraRef.current || !ready || taking) return;
    console.log('[android-camera] shutter tapped - capturing...');
    setTaking(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.92,        // high at capture - we compress before upload
        skipProcessing: false,
      });
      if (!photo?.uri) {
        console.warn('[android-camera] takePictureAsync returned no URI');
        return;
      }
      console.log('[android-camera] photo captured:', photo.uri,
        `(${photo.width}×${photo.height})`);
      setCapturedUri(photo.uri);
      setScreen('preview');
      console.log('[android-camera] preview shown');
    } catch (e) {
      console.error('[android-camera] takePictureAsync failed:', e);
    } finally {
      setTaking(false);
    }
  }

  // ── Preview actions ───────────────────────────────────────────────────────

  function handleRetake() {
    console.log('[android-camera] retake tapped');
    setCapturedUri(null);
    setScreen('camera');
  }

  async function handleUsePhoto() {
    if (!capturedUri) return;
    console.log('[android-camera] use photo tapped - compressing...');
    setCompressing(true);
    try {
      // SDK 53 chained API. The legacy manipulateAsync() still works but is
      // deprecated and slated for removal in a future SDK - using the new
      // builder keeps this code compatible across upgrades.
      const ctx = ImageManipulator.manipulate(capturedUri);
      ctx.resize({ width: MAX_WIDTH });
      const rendered = await ctx.renderAsync();
      const result = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
      console.log('[android-camera] compressed →', result.uri,
        `(${result.width}×${result.height})`);
      onCapture(result.uri);
    } catch (e) {
      console.error('[android-camera] compression failed - using original:', e);
      onCapture(capturedUri); // graceful fallback
    } finally {
      setCompressing(false);
    }
  }

  // ── Flash cycle: off → on → auto ─────────────────────────────────────────

  function cycleFlash() {
    setFlash(f => {
      const next: FlashMode = f === 'off' ? 'on' : f === 'on' ? 'auto' : 'off';
      console.log('[android-camera] flash →', next);
      return next;
    });
  }

  const flashIcon = flash === 'on'
    ? 'flash'
    : flash === 'auto'
    ? 'flash-outline'
    : 'flash-off-outline';

  // ── Permission gate ───────────────────────────────────────────────────────

  if (!permission) return null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
      onShow={handleModalShow}
    >
      <SafeAreaView style={styles.root}>

        {/* ── Permission denied ─────────────────────────────────────────── */}
        {!permission.granted ? (
          <View style={styles.center}>
            <View style={styles.permIcon}><Ionicons name="camera-outline" size={34} color={colors.primaryOnTint} /></View>
            <Text style={styles.permText}>{t('composer.cameraPermBody')}</Text>
            <Button label={t('camera.grant')} onPress={requestPermission} style={styles.permBtn} />
            <Button variant="secondary" label={t('cancel')} onPress={onClose} style={styles.permBtn} />
          </View>

        /* ── Preview screen ─────────────────────────────────────────────── */
        ) : screen === 'preview' && capturedUri ? (
          <View style={styles.previewRoot}>
            {/* Full-screen image */}
            <Image source={{ uri: capturedUri }} style={styles.previewImage} resizeMode="cover" />

            {/* Close button (top-left) */}
            <IconButton icon="close" tone="onPhoto" iconSize={26} label={t('close')} onPress={onClose} style={styles.previewClose} />

            {/* Action bar - paddingBottom absorbs bottom nav bar on Android */}
            <View style={[styles.previewBar, insets.bottom > 0 && { paddingBottom: 20 + insets.bottom }]}>

              {/* Retake */}
              <TouchableOpacity
                style={styles.retakeBtn}
                onPress={handleRetake}
                disabled={compressing}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <Ionicons name="camera-outline" size={20} color={colors.white} />
                <Text style={styles.retakeBtnText}>{t('camera.retake')}</Text>
              </TouchableOpacity>

              {/* Use Photo - primary CTA */}
              <Button icon="checkmark" label={t('camera.usePhoto')} onPress={handleUsePhoto} loading={compressing} style={styles.useBtn} />

            </View>
          </View>

        /* ── Camera viewfinder ──────────────────────────────────────────── */
        ) : (
          <>
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing={facing}
              flash={flash}
              onCameraReady={() => {
                console.log('[android-camera] camera ready (facing:', facing + ')');
                setReady(true);
              }}
            />

            {/* ── Top bar: close + flash ───────────────────────────────── */}
            <View style={styles.topBar}>
              <TouchableOpacity style={styles.iconBtn} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('close')}>
                <Ionicons name="close" size={28} color={colors.white} />
              </TouchableOpacity>

              <TouchableOpacity style={styles.iconBtn} onPress={cycleFlash} accessibilityRole="button" accessibilityLabel={t('camera.flash')}>
                <Ionicons name={flashIcon} size={26} color={flash !== 'off' ? colors.gold : colors.white} />
              </TouchableOpacity>
            </View>

            {/* ── Bottom bar: shutter + flip ───────────────────────────── */}
            <View style={[styles.bottomBar, insets.bottom > 0 && { height: 120 + insets.bottom, paddingBottom: 16 + insets.bottom }]}>

              {/* Spacer (keeps shutter centred) */}
              <View style={styles.iconBtn} />

              {/* Shutter */}
              <TouchableOpacity
                style={[styles.shutter, (!ready || taking) && styles.shutterDisabled]}
                onPress={takePhoto}
                disabled={!ready || taking}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={t('composer.takePhoto')}
              >
                {taking
                  ? <ActivityIndicator size="small" color={colors.white} />
                  : <View style={styles.shutterInner} />}
              </TouchableOpacity>

              {/* Flip */}
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => {
                  setReady(false); // camera needs to reinitialize after flip
                  setFacing(f => f === 'back' ? 'front' : 'back');
                  console.log('[android-camera] flip →', facing === 'back' ? 'front' : 'back');
                }}
                disabled={taking}
                accessibilityRole="button"
                accessibilityLabel={t('camera.flip')}
              >
                <Ionicons name="camera-reverse-outline" size={28} color={colors.white} />
              </TouchableOpacity>

            </View>
          </>
        )}

      </SafeAreaView>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  // The camera and its preview stay black in both themes; the permission screen follows the theme.
  root:   { flex: 1, backgroundColor: c.photoScrim },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: Spacing.lg, backgroundColor: c.bg },
  permIcon: { width: 72, height: 72, borderRadius: Radius.full, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  permText: { color: c.text, fontSize: 16, fontWeight: '600', textAlign: 'center', lineHeight: 22, marginBottom: 8 },
  permBtn:  { alignSelf: 'stretch' },

  camera:    { flex: 1 },
  topBar:    { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
               paddingTop: 8, paddingHorizontal: 8, backgroundColor: c.photoControl },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 120, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
               paddingBottom: 16, backgroundColor: c.photoControl },
  iconBtn:   { width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
  shutter:         { width: 78, height: 78, borderRadius: Radius.full, borderWidth: 4, borderColor: c.white, alignItems: 'center', justifyContent: 'center' },
  shutterInner:    { width: 60, height: 60, borderRadius: Radius.full, backgroundColor: c.white },
  shutterDisabled: { opacity: 0.4 },

  previewRoot:  { flex: 1, backgroundColor: c.photoScrim },
  previewImage: { flex: 1 },
  previewClose: { position: 'absolute', top: 12, left: 12 },
  previewBar:   { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                  gap: 12, paddingHorizontal: 20, paddingVertical: 20, backgroundColor: c.photoScrim },
  retakeBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, paddingHorizontal: 20, borderRadius: Radius.button,
                   backgroundColor: c.photoControl },
  retakeBtnText: { color: c.white, fontSize: 15, fontWeight: '700' },
  useBtn:        { flex: 1 },
});
