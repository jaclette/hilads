/**
 * AndroidCameraCapture — in-app camera modal for Android.
 *
 * Why: expo-image-picker's launchCameraAsync() uses ActivityResultLauncher
 * internally. On Android 14 + singleTask MainActivity the result callback
 * never fires, so the promise hangs until the app is backgrounded/foregrounded.
 *
 * This component renders a full-screen Modal with expo-camera's CameraView,
 * completely bypassing the ActivityResultLauncher path. It is only used on
 * Android; iOS continues to use launchCameraAsync().
 */

import { useRef, useState, useCallback } from 'react';
import {
  Modal, View, TouchableOpacity, ActivityIndicator,
  StyleSheet, SafeAreaView, Text,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { CameraViewRef } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants';

interface Props {
  visible: boolean;
  onCapture: (uri: string) => void;
  onClose: () => void;
}

export function AndroidCameraCapture({ visible, onCapture, onClose }: Props) {
  const cameraRef = useRef<CameraViewRef>(null);
  const [ready, setReady]       = useState(false);
  const [taking, setTaking]     = useState(false);
  const [facing, setFacing]     = useState<'back' | 'front'>('back');
  const [permission, requestPermission] = useCameraPermissions();

  // Reset readiness every time the modal opens
  const handleVisible = useCallback((vis: boolean) => {
    if (vis) setReady(false);
  }, []);

  async function takePhoto() {
    if (!cameraRef.current || !ready || taking) return;
    console.log('[android-camera] taking picture...');
    setTaking(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, skipProcessing: false });
      if (!photo?.uri) {
        console.warn('[android-camera] no URI in result');
        return;
      }
      console.log('[android-camera] photo taken:', photo.uri);
      onCapture(photo.uri);
    } catch (e) {
      console.error('[android-camera] takePictureAsync failed:', e);
    } finally {
      setTaking(false);
    }
  }

  // ── Permission not yet determined ──────────────────────────────────────────
  if (!permission) {
    return null;
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>

        {/* ── Permission denied ────────────────────────────────────────────── */}
        {!permission.granted ? (
          <View style={styles.permDenied}>
            <Text style={styles.permText}>Camera access is required to take photos.</Text>
            <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
              <Text style={styles.permBtnText}>Grant permission</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.permBtn, { marginTop: 12 }]} onPress={onClose}>
              <Text style={styles.permBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* ── Live preview ─────────────────────────────────────────────── */}
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing={facing}
              onCameraReady={() => {
                console.log('[android-camera] camera ready');
                setReady(true);
              }}
            />

            {/* ── Controls overlay ─────────────────────────────────────────── */}
            <View style={styles.controls}>

              {/* Close */}
              <TouchableOpacity style={styles.sideBtn} onPress={onClose}>
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>

              {/* Shutter */}
              <TouchableOpacity
                style={[styles.shutter, (!ready || taking) && styles.shutterDisabled]}
                onPress={takePhoto}
                disabled={!ready || taking}
                activeOpacity={0.7}
              >
                {taking
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <View style={styles.shutterInner} />}
              </TouchableOpacity>

              {/* Flip */}
              <TouchableOpacity
                style={styles.sideBtn}
                onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')}
              >
                <Ionicons name="camera-reverse-outline" size={28} color="#fff" />
              </TouchableOpacity>

            </View>
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  controls: {
    position:        'absolute',
    bottom:          0,
    left:            0,
    right:           0,
    height:          120,
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'space-around',
    paddingBottom:   20,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sideBtn: {
    width:          56,
    height:         56,
    alignItems:     'center',
    justifyContent: 'center',
  },
  shutter: {
    width:           76,
    height:          76,
    borderRadius:    38,
    borderWidth:     4,
    borderColor:     '#fff',
    alignItems:      'center',
    justifyContent:  'center',
  },
  shutterInner: {
    width:           58,
    height:          58,
    borderRadius:    29,
    backgroundColor: '#fff',
  },
  shutterDisabled: {
    opacity: 0.4,
  },
  permDenied: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    padding:        32,
  },
  permText: {
    color:      '#fff',
    fontSize:   16,
    textAlign:  'center',
    marginBottom: 24,
  },
  permBtn: {
    backgroundColor: Colors.accent,
    paddingHorizontal: 24,
    paddingVertical:   12,
    borderRadius:      24,
  },
  permBtnText: {
    color:      '#fff',
    fontSize:   15,
    fontWeight: '600',
  },
});
