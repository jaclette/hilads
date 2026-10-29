import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import { FontSizes, Radius, Spacing, type ThemeColors } from '@/constants';
import { useTheme, useThemedStyles } from '@/context/ThemeContext';
import { useModalStatusBar } from '@/lib/useModalStatusBar';
import { Button, DualPhoto, IconButton } from '@/ui';

/**
 * The Daily photo camera, BeReal style (docs/dual-photo-audit.md). Android:
 * our back camera (pinch to zoom, flash off / auto / on) for the photo. iOS
 * (hybrid): the system camera takes the photo (lenses, macro, tap-to-focus,
 * HDR) and this opens on the selfie with `selfieFor`. Then the front camera with a live
 * preview and a 3-2-1 countdown for the selfie (a tap on the shutter takes it
 * earlier), then a review laid out like the post (tap the inset to swap):
 * Retake selfie, Retake all, Remove selfie / Add your face, Use.
 *
 * "Dual" on the viewfinder turns the selfie off (one photo, as before); the
 * choice is remembered. No front camera, a switch that fails or never gets
 * ready: the photo goes alone, with a short notice, never a crash.
 */

export interface DualShot { main: string; selfie: string | null }

// The front "screen flash": a white screen at full brightness while the selfie
// is taken (night photos: Night out, Halloween). expo-brightness is a native
// module: loaded defensively, a binary without it keeps the white screen only.
type BrightnessModule = { getBrightnessAsync(): Promise<number>; setBrightnessAsync(v: number): Promise<void> };
let brightnessModule: BrightnessModule | null | undefined;
function brightness(): BrightnessModule | null {
  if (brightnessModule === undefined) {
    try { brightnessModule = require('expo-brightness') as BrightnessModule; }   // eslint-disable-line @typescript-eslint/no-require-imports
    catch { brightnessModule = null; }
  }
  return brightnessModule;
}
/** Is it dark out? From 18:00 to 07:00 local time. */
function isNight(d = new Date()): boolean {
  const h = d.getHours();
  return h >= 18 || h < 7;
}
const SCREEN_FLASH_MS = 350;   // the white screen lights the face before the shot

const DUAL_KEY = 'hilads_dual_photo';

/** The person's Dual choice (on unless they turned it off), for the iOS hybrid flow. */
export async function dualPreferred(): Promise<boolean> {
  return (await AsyncStorage.getItem(DUAL_KEY).catch(() => null)) !== '0';
}
const COUNTDOWN_FROM = 3;
const FRONT_TIMEOUT_MS = 5000;

type Phase = 'main' | 'selfie' | 'review';

export function DualCamera({ visible, initial, selfieFor = null, night = false, onRetakeMain, onCapture, onClose }: {
  visible: boolean;
  /** iOS hybrid / Add your face: the photo is taken (system camera, or already there); open on its selfie. */
  selfieFor?: string | null;
  /** Retake all with the system camera (iOS): the caller closes this and opens it. */
  onRetakeMain?: () => void;
  /** A night theme (Night out, a night special like Halloween): the screen flash starts on. */
  night?: boolean;
  /** The shots to review again (e.g. "Retake" from a later step keeps nothing). */
  initial?: DualShot | null;
  onCapture: (shot: DualShot) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('daily');
  const { t: tc } = useTranslation('common');
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [permission, requestPermission] = useCameraPermissions();
  const shown = useModalStatusBar(visible, !!permission?.granted);
  const camera = useRef<CameraView>(null);

  const [dual, setDual] = useState(true);
  const [phase, setPhase] = useState<Phase>('main');
  const [backFacing, setBackFacing] = useState<'back' | 'front'>('back');
  const [ready, setReady] = useState(false);
  const [taking, setTaking] = useState(false);
  const [flash, setFlash] = useState<'off' | 'auto' | 'on'>('off');
  const [zoom, setZoom] = useState(0);
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const [main, setMain] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wink, setWink] = useState(false);
  // The selfie's screen flash: on at night or for a night theme, the person can switch it.
  const [screenFlash, setScreenFlash] = useState(false);
  const [lit, setLit] = useState(false);
  const frontTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(DUAL_KEY).then(v => { if (v === '0') setDual(false); }).catch(() => {});
  }, []);

  const clearTimers = () => {
    if (frontTimer.current) clearTimeout(frontTimer.current);
    if (tick.current) clearTimeout(tick.current);
    frontTimer.current = tick.current = null;
  };
  useEffect(() => clearTimers, []);

  // Each opening starts over (or on the shots to review again).
  const onShow = () => {
    clearTimers();
    setReady(false); setTaking(false); setCount(null); setNotice(null); setWink(false); setLit(false);
    setScreenFlash(night || isNight());
    setZoom(0);
    if (initial) { setMain(initial.main); setSelfie(initial.selfie); setPhase('review'); }
    else if (selfieFor) { setMain(selfieFor); setSelfie(null); setDual(true); toSelfie(); }
    else { setMain(null); setSelfie(null); setPhase('main'); }
  };

  // Pinch to zoom on the photo's viewfinder (Android; iOS uses the system camera's lenses).
  const onTouchMove = (e: { nativeEvent: { touches: { pageX: number; pageY: number }[] } }) => {
    const t2 = e.nativeEvent.touches;
    if (t2.length !== 2) { pinch.current = null; return; }
    const dist = Math.hypot(t2[0].pageX - t2[1].pageX, t2[0].pageY - t2[1].pageY);
    if (!pinch.current) { pinch.current = { dist, zoom }; return; }
    setZoom(Math.min(1, Math.max(0, pinch.current.zoom + (dist - pinch.current.dist) / 600)));
  };

  const toggleDual = () => {
    const next = !dual;
    setDual(next);
    Haptics.selectionAsync().catch(() => {});
    AsyncStorage.setItem(DUAL_KEY, next ? '1' : '0').catch(() => {});
    // Off on the selfie screen: no selfie this time (the photo goes alone).
    if (!next && phase === 'selfie') { clearTimers(); setCount(null); setSelfie(null); setNotice(null); setPhase('review'); }
  };

  // ── The flash between the two cameras, the countdown's bouncy numbers ──
  const flashOpacity = useSharedValue(0);
  const numScale = useSharedValue(1);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flashOpacity.value }));
  const numStyle = useAnimatedStyle(() => ({ transform: [{ scale: numScale.value }] }));

  const shoot = async (): Promise<string | null> => {
    if (!camera.current) return null;
    setTaking(true);
    try {
      const pic = await camera.current.takePictureAsync({ quality: 0.9, skipProcessing: false });
      return pic?.uri ?? null;
    } catch (e) {
      console.warn('[dual-camera] capture failed:', String(e));
      return null;
    } finally {
      setTaking(false);
    }
  };

  /** Go to the selfie: the flash, the front camera, then the countdown once it's ready. */
  const toSelfie = () => {
    clearTimers();
    setReady(false);
    setCount(null);
    setPhase('selfie');
    if (!reduced) flashOpacity.value = withSequence(withTiming(1, { duration: 80 }), withTiming(0, { duration: 320 }));
    // A front camera that never gets ready (none, or a failed switch): the photo goes alone.
    frontTimer.current = setTimeout(() => {
      setNotice(t('dual.frontFailed'));
      setPhase('review');
    }, FRONT_TIMEOUT_MS);
  };

  const takeMain = async () => {
    if (!ready || taking) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const uri = await shoot();
    if (!uri) return;
    setMain(uri);
    if (dual) toSelfie();
    else { setSelfie(null); setPhase('review'); }
  };

  const takeSelfie = async () => {
    if (taking) return;
    clearTimers();
    setCount(null);
    setWink(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // Screen flash: white screen, full brightness, a moment for the exposure, the shot, then back.
    let before: number | null = null;
    if (screenFlash) {
      setLit(true);
      const b = brightness();
      if (b) { before = await b.getBrightnessAsync().catch(() => null); await b.setBrightnessAsync(1).catch(() => {}); }
      await new Promise(r => setTimeout(r, SCREEN_FLASH_MS));
    }
    const uri = await shoot();
    if (screenFlash) {
      if (before !== null) brightness()?.setBrightnessAsync(before).catch(() => {});
      setLit(false);
    }
    setWink(false);
    if (uri) { setSelfie(uri); setNotice(null); }
    else setNotice(t('dual.frontFailed'));
    setPhase('review');
  };

  // The countdown starts when the front camera is ready: 3, 2, 1, snap.
  const onReady = () => {
    setReady(true);
    if (phase !== 'selfie') return;
    if (frontTimer.current) { clearTimeout(frontTimer.current); frontTimer.current = null; }
    const step = (n: number) => {
      if (n === 0) { takeSelfie(); return; }
      setCount(n);
      if (!reduced) numScale.value = withSequence(withTiming(1.6, { duration: 1 }), withSpring(1, { damping: 6, stiffness: 180 }));
      Haptics.selectionAsync().catch(() => {});
      tick.current = setTimeout(() => step(n - 1), 900);
    };
    step(COUNTDOWN_FROM);
  };

  const facing = phase === 'selfie' ? (backFacing === 'back' ? 'front' : 'back') : backFacing;
  const top = insets.top + Spacing.sm;

  if (!permission) return null;

  return (
    <Modal visible={shown} animationType={selfieFor ? 'fade' : 'slide'} statusBarTranslucent navigationBarTranslucent onRequestClose={onClose} onShow={onShow}>
      <View style={styles.root}>
        {!permission.granted ? (
          <View style={[styles.center, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <View style={styles.permIcon}><Ionicons name="camera-outline" size={34} color={colors.primaryOnTint} /></View>
            <Text style={styles.permText}>{tc('composer.cameraPermBody')}</Text>
            <Button label={tc('camera.grant')} onPress={requestPermission} style={styles.stretch} />
            <Button variant="secondary" label={tc('cancel')} onPress={onClose} style={styles.stretch} />
          </View>
        ) : phase === 'review' && main ? (
          // ── Review: laid out like the post ──
          <View style={styles.root}>
            <DualPhoto main={{ uri: main }} selfie={selfie ? { uri: selfie } : null} style={StyleSheet.absoluteFill} insetTop={top + 52} />
            <IconButton icon="close" tone="onPhoto" iconSize={26} label={tc('close')} onPress={onClose} style={[styles.closeTop, { top }]} />
            {!!notice && <Text style={[styles.notice, { top: top + 60 }]}>{notice}</Text>}
            <View style={[styles.reviewBar, { paddingBottom: 20 + insets.bottom }]}>
              {!!selfie && <Text style={styles.hint}>{t('dual.swapHint')}</Text>}
              <View style={styles.row}>
                <Chip icon="camera-reverse-outline" label={selfie ? t('dual.retakeSelfie') : t('dual.addFace')} onPress={toSelfie} />
                {!!selfie && <Chip icon="close-circle-outline" label={t('dual.removeSelfie')} onPress={() => setSelfie(null)} />}
                <Chip icon="refresh" label={t('dual.retakeAll')} onPress={() => {
                  if (onRetakeMain) { onRetakeMain(); return; }
                  setMain(null); setSelfie(null); setNotice(null); setReady(false); setPhase('main');
                }} />
              </View>
              <Button icon="checkmark" label={tc('camera.usePhoto')} onPress={() => onCapture({ main, selfie })} testID="camera-use" />
            </View>
          </View>
        ) : (
          // ── Viewfinder: the photo (back), then the selfie (front) ──
          <>
            <CameraView
              key={facing}
              ref={camera}
              style={styles.flex}
              facing={facing}
              flash={phase === 'main' ? flash : 'off'}
              zoom={phase === 'main' ? zoom : 0}
              onCameraReady={onReady}
              onMountError={() => { if (phase === 'selfie') { clearTimers(); setNotice(t('dual.frontFailed')); setPhase('review'); } }}
            />
            {/* Pinch to zoom on the photo's viewfinder. */}
            {phase === 'main' && (
              <View style={StyleSheet.absoluteFill} onTouchMove={onTouchMove} onTouchEnd={() => { pinch.current = null; }} />
            )}
            {/* The main photo, small, while the selfie is taken: what it goes with. */}
            {phase === 'selfie' && main && (
              <View style={[styles.mainThumb, { top: top + 60 }]} pointerEvents="none">
                <DualPhoto main={{ uri: main }} style={StyleSheet.absoluteFill} />
              </View>
            )}
            <View style={[styles.topBar, { top }]} pointerEvents="box-none">
              <IconButton icon="close" tone="onPhoto" iconSize={28} label={tc('close')} onPress={onClose} />
              {(phase === 'main' || phase === 'selfie') && (
                <TouchableOpacity style={[styles.dual, dual && styles.dualOn]} onPress={toggleDual} accessibilityRole="switch"
                                  accessibilityState={{ checked: dual }} accessibilityLabel={dual ? t('dual.on') : t('dual.off')}>
                  <Text style={styles.dualEmoji}>🤳</Text>
                  <Text style={[styles.dualText, dual && styles.dualTextOn]}>{t('dual.toggle')}</Text>
                </TouchableOpacity>
              )}
              {phase === 'main' ? (
                // The rear flash: off → auto → on.
                <TouchableOpacity style={styles.round} onPress={() => setFlash(f => (f === 'off' ? 'auto' : f === 'auto' ? 'on' : 'off'))}
                                  accessibilityRole="button" accessibilityLabel={tc('camera.flash')} accessibilityValue={{ text: flash }}>
                  <Ionicons name={flash === 'on' ? 'flash' : flash === 'auto' ? 'flash-outline' : 'flash-off-outline'} size={24}
                            color={flash === 'off' ? colors.white : colors.gold} />
                  {flash === 'auto' && <Text style={styles.auto}>A</Text>}
                </TouchableOpacity>
              ) : (
                // The selfie's screen flash (front camera: the screen lights the face).
                <TouchableOpacity style={styles.round} onPress={() => setScreenFlash(v => !v)} accessibilityRole="switch"
                                  accessibilityState={{ checked: screenFlash }} accessibilityLabel={tc('camera.flash')}>
                  <Ionicons name={screenFlash ? 'flash' : 'flash-off-outline'} size={24} color={screenFlash ? colors.gold : colors.white} />
                </TouchableOpacity>
              )}
            </View>

            {phase === 'selfie' && (
              <View style={styles.countWrap} pointerEvents="none">
                <Text style={styles.nowYou}>{t('dual.nowYou')}</Text>
                {wink ? <Text style={styles.count}>😉</Text>
                  : count !== null && <Animated.Text style={[styles.count, numStyle]}>{count}</Animated.Text>}
              </View>
            )}

            <View style={[styles.bottomBar, { paddingBottom: 16 + insets.bottom }]}>
              <View style={styles.round} />
              <TouchableOpacity style={[styles.shutter, (!ready || taking) && styles.dim]} disabled={!ready || taking}
                                onPress={phase === 'main' ? takeMain : takeSelfie} accessibilityRole="button"
                                accessibilityLabel={phase === 'main' ? tc('composer.takePhoto') : t('dual.nowYou')} testID="camera-shutter">
                {taking ? <ActivityIndicator color={colors.white} /> : <View style={styles.shutterInner} />}
              </TouchableOpacity>
              {phase === 'main' ? (
                <TouchableOpacity style={styles.round} onPress={() => { setReady(false); setBackFacing(f => (f === 'back' ? 'front' : 'back')); }}
                                  disabled={taking} accessibilityRole="button" accessibilityLabel={tc('camera.flip')}>
                  <Ionicons name="camera-reverse-outline" size={28} color={colors.white} />
                </TouchableOpacity>
              ) : <View style={styles.round} />}
            </View>
            <Animated.View style={[StyleSheet.absoluteFill, styles.flash, flashStyle]} pointerEvents="none" />
            {lit && <View style={[StyleSheet.absoluteFill, styles.flash]} pointerEvents="none" />}
          </>
        )}
      </View>
    </Modal>
  );
}

function Chip({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <TouchableOpacity style={styles.chip} onPress={onPress} accessibilityRole="button">
      <Ionicons name={icon} size={16} color={colors.white} />
      <Text style={styles.chipText} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

// The camera stays dark in both themes (fixed photo tokens); the permission screen follows the theme.
const makeStyles = (c: ThemeColors) => StyleSheet.create({
  root:      { flex: 1, backgroundColor: c.photoScrim },
  flex:      { flex: 1 },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: Spacing.lg, backgroundColor: c.bg },
  permIcon:  { width: 72, height: 72, borderRadius: Radius.full, backgroundColor: c.primaryTint, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  permText:  { color: c.text, fontSize: 16, fontWeight: '600', textAlign: 'center', lineHeight: 22, marginBottom: 8 },
  stretch:   { alignSelf: 'stretch' },
  topBar:    { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.md },
  round:     { width: 48, height: 48, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: c.photoButton },
  dual:      { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: Radius.full,
               backgroundColor: c.photoButton, borderWidth: 1.5, borderColor: c.onPhotoLine },
  dualOn:    { backgroundColor: c.white, borderColor: c.white },
  dualEmoji: { fontSize: 16 },
  dualText:  { fontSize: FontSizes.sm, fontWeight: '800', color: c.white },
  dualTextOn:{ color: c.onGold },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
               paddingTop: 16, backgroundColor: c.photoControl },
  shutter:      { width: 78, height: 78, borderRadius: Radius.full, borderWidth: 4, borderColor: c.white, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: Radius.full, backgroundColor: c.white },
  dim:       { opacity: 0.4 },
  auto:      { position: 'absolute', right: 8, bottom: 6, fontSize: 10, fontWeight: '800', color: c.gold },
  flash:     { backgroundColor: c.white },
  mainThumb: { position: 'absolute', left: Spacing.md, width: 84, height: 112, borderRadius: 12, overflow: 'hidden', borderWidth: 2, borderColor: c.white },
  countWrap: { position: 'absolute', left: 0, right: 0, top: '30%', alignItems: 'center', gap: 6 },
  nowYou:    { fontSize: FontSizes.xl, fontWeight: '800', color: c.white, textShadowColor: c.photoBlurShade, textShadowRadius: 6 },
  count:     { fontSize: 96, lineHeight: 110, fontWeight: '800', color: c.white, textShadowColor: c.photoBlurShade, textShadowRadius: 10 },
  closeTop:  { position: 'absolute', left: Spacing.md },
  notice:    { position: 'absolute', left: Spacing.md, right: Spacing.md, textAlign: 'center', color: c.white, fontSize: FontSizes.sm, fontWeight: '700',
               backgroundColor: c.photoButton, borderRadius: Radius.md, overflow: 'hidden', paddingVertical: 8, paddingHorizontal: 12 },
  reviewBar: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: 12, paddingHorizontal: 20, paddingTop: 16, backgroundColor: c.photoBlurShade },
  hint:      { color: c.white, fontSize: FontSizes.xs, fontWeight: '700', textAlign: 'center' },
  row:       { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  chip:      { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: Radius.full, backgroundColor: c.photoControl },
  chipText:  { color: c.white, fontSize: FontSizes.sm, fontWeight: '700' },
});
