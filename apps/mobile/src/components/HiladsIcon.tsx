/**
 * HiladsIcon - faithful View recreation of Logo.jsx SVG.
 *
 * SVG viewBox 64×64, scaled to target size (scale = size/64).
 * Background: rounded-rect orange gradient - direct port of the web
 *   .logoMark linear-gradient(135deg, #FF7A3C, #C24A38) (DeleteAccountPage).
 * H letterform: two vertical bars + horizontal crossbar.
 * ¡ letterform: vertical bar + circle dot with pulse animation.
 */

import { useRef, useEffect } from 'react';
import { View, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gradients } from '@/constants';

export function HiladsIcon({ size = 46 }: { size?: number }) {
  const scale   = size / 64;
  const dotAnim = useRef(new Animated.Value(0.82)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(dotAnim, { toValue: 1,    duration: 1500, useNativeDriver: true }),
        Animated.timing(dotAnim, { toValue: 0.82, duration: 1500, useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  function s(v: number) { return v * scale; }

  return (
    <View style={{
      width:        size,
      height:       size,
      borderRadius: s(15),
      overflow:     'hidden',
    }}>
      <LinearGradient
        colors={Gradients.logo.colors}
        start={Gradients.logo.start}
        end={Gradients.logo.end}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {/* H - left vertical bar (x=9, y=13, w=8, h=38, rx=2.5) */}
      <View style={{
        position: 'absolute', left: s(9), top: s(13),
        width: s(8), height: s(38), borderRadius: s(2.5), backgroundColor: 'white',
      }} />
      {/* H - right vertical bar (x=26, y=13, w=8, h=38, rx=2.5) */}
      <View style={{
        position: 'absolute', left: s(26), top: s(13),
        width: s(8), height: s(38), borderRadius: s(2.5), backgroundColor: 'white',
      }} />
      {/* H - crossbar (x=17, y=28, w=9, h=6, rx=2) */}
      <View style={{
        position: 'absolute', left: s(17), top: s(28),
        width: s(9), height: s(6), borderRadius: s(2), backgroundColor: 'white',
      }} />
      {/* ¡ - vertical bar (x=43, y=25, w=8, h=26, rx=2.5) */}
      <View style={{
        position: 'absolute', left: s(43), top: s(25),
        width: s(8), height: s(26), borderRadius: s(2.5), backgroundColor: 'white',
      }} />
      {/* ¡ - dot circle (cx=47, cy=15, r=5.5) with pulse */}
      <Animated.View style={{
        position:        'absolute',
        left:            s(47 - 5.5),
        top:             s(15 - 5.5),
        width:           s(11),
        height:          s(11),
        borderRadius:    s(5.5),
        backgroundColor: 'white',
        opacity:         dotAnim,
      }} />
    </View>
  );
}
