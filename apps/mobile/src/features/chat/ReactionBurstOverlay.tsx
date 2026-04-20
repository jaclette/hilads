/**
 * ReactionBurstOverlay
 *
 * Renders ephemeral reaction particle animations anchored inside a message row.
 * Positioned absolutely so the message list never re-renders on animation trigger.
 * Uses React Native's built-in Animated API — no extra dependencies.
 *
 * Architecture:
 *   reactionEmitter.emit(messageId, type)
 *     └─→ <ReactionBurstOverlay messageId={...}> subscribes and spawns particles
 *
 * Each particle is a separate Animated.Text node that auto-removes after finishing.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import { reactionEmitter, type ReactionType } from '@/lib/reactionEmitter';

// ── Per-type config ───────────────────────────────────────────────────────────

interface BurstConfig {
  emoji:   string;
  count:   number;
  duration: number;          // base animation duration (ms)
  stagger: number;           // ms between successive particles
  minSize: number;
  maxSize: number;
  dxRange: number;           // max horizontal drift (± pixels)
  dyRange: [number, number]; // [min, max] upward travel in pixels
}

const CONFIGS: Record<ReactionType, BurstConfig> = {
  heart: { emoji: '❤️', count: 6, duration: 1100, stagger: 60,  minSize: 14, maxSize: 24, dxRange: 30, dyRange: [50,  100] },
  like:  { emoji: '👍', count: 5, duration: 900,  stagger: 50,  minSize: 16, maxSize: 26, dxRange: 28, dyRange: [35,  80]  },
  laugh: { emoji: '😂', count: 5, duration: 1050, stagger: 70,  minSize: 16, maxSize: 26, dxRange: 38, dyRange: [45,  90]  },
  wow:   { emoji: '😮', count: 4, duration: 1000, stagger: 80,  minSize: 18, maxSize: 30, dxRange: 22, dyRange: [30,  70]  },
  fire:  { emoji: '🔥', count: 7, duration: 1200, stagger: 45,  minSize: 14, maxSize: 22, dxRange: 20, dyRange: [55,  110] },
};

function rand(min: number, max: number) { return min + Math.random() * (max - min); }

// ── Easing functions ──────────────────────────────────────────────────────────

const easeOut   = (t: number): number => 1 - (1 - t) ** 3;
const easeIn    = (t: number): number => t ** 3;
const easeInOut = (t: number): number => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

// ── Single particle ───────────────────────────────────────────────────────────

interface ParticleProps {
  type:     ReactionType;
  emoji:    string;
  size:     number;
  dx:       number;
  dy:       number;
  delay:    number;
  duration: number;
  onDone:   () => void;
}

function Particle({ type, emoji, size, dx, dy, delay, duration: dur, onDone }: ParticleProps) {
  const opacity    = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const scale      = useRef(new Animated.Value(0.3)).current;
  const rotate     = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.parallel(buildAnims(type, { opacity, translateX, translateY, scale, rotate, dx, dy, dur }));
    const timer = setTimeout(() => anim.start(({ finished }) => { if (finished) onDone(); }), delay);
    return () => { clearTimeout(timer); anim.stop(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rotDeg = rotate.interpolate({ inputRange: [-1, 1], outputRange: ['-30deg', '30deg'] });

  return (
    <Animated.Text
      style={[
        styles.particle,
        { fontSize: size, opacity, transform: [{ translateX }, { translateY }, { scale }, { rotate: rotDeg }] },
      ]}
      pointerEvents="none"
    >
      {emoji}
    </Animated.Text>
  );
}

// ── Per-type animation builders ───────────────────────────────────────────────

interface AnimVals {
  opacity:    Animated.Value;
  translateX: Animated.Value;
  translateY: Animated.Value;
  scale:      Animated.Value;
  rotate:     Animated.Value;
  dx: number; dy: number; dur: number;
}

function buildAnims(type: ReactionType, v: AnimVals): Animated.CompositeAnimation[] {
  const { opacity, translateX, translateY, scale, rotate, dx, dy, dur } = v;
  const N = (ratio: number) => dur * ratio;

  switch (type) {
    // ❤️  smooth float up + fade, gentle spring pop
    case 'heart': return [
      Animated.sequence([
        Animated.timing(opacity,    { toValue: 1,    duration: N(0.1),  useNativeDriver: true }),
        Animated.timing(opacity,    { toValue: 0,    duration: N(0.4),  delay: N(0.5), useNativeDriver: true }),
      ]),
      Animated.timing(translateX,   { toValue: dx,   duration: dur,     easing: easeOut, useNativeDriver: true }),
      Animated.timing(translateY,   { toValue: -dy,  duration: dur,     easing: easeOut, useNativeDriver: true }),
      Animated.sequence([
        Animated.spring(scale,      { toValue: 1.2,  speed: 50, bounciness: 4, useNativeDriver: true }),
        Animated.timing(scale,      { toValue: 0.5,  duration: N(0.45), delay: N(0.4),  useNativeDriver: true }),
      ]),
    ];

    // 👍  pop from zero (spring bounce), arc up then gravity drop
    case 'like': return [
      Animated.sequence([
        Animated.timing(opacity,    { toValue: 1,    duration: N(0.08), useNativeDriver: true }),
        Animated.timing(opacity,    { toValue: 0,    duration: N(0.35), delay: N(0.55), useNativeDriver: true }),
      ]),
      Animated.timing(translateX,   { toValue: dx,   duration: dur,     easing: easeInOut, useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(translateY, { toValue: -(dy * 0.55), duration: N(0.45), easing: easeOut, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: -dy,          duration: N(0.55), easing: easeIn,  useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.spring(scale,      { toValue: 1.3,  speed: 60, bounciness: 8, useNativeDriver: true }),
        Animated.timing(scale,      { toValue: 0.7,  duration: N(0.4),  delay: N(0.45), useNativeDriver: true }),
      ]),
    ];

    // 😂  zigzag horizontal wobble while rising + spin
    case 'laugh': return [
      Animated.sequence([
        Animated.timing(opacity,    { toValue: 1,    duration: N(0.1),  useNativeDriver: true }),
        Animated.timing(opacity,    { toValue: 0,    duration: N(0.38), delay: N(0.52), useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(translateX, { toValue: dx * -0.6, duration: N(0.28), easing: easeOut, useNativeDriver: true }),
        Animated.timing(translateX, { toValue: dx,         duration: N(0.72), easing: easeOut, useNativeDriver: true }),
      ]),
      Animated.timing(translateY,   { toValue: -dy,  duration: dur,     easing: easeOut, useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(scale,      { toValue: 1.15, duration: N(0.25), useNativeDriver: true }),
        Animated.timing(scale,      { toValue: 0.85, duration: N(0.25), useNativeDriver: true }),
        Animated.timing(scale,      { toValue: 0.5,  duration: N(0.5),  useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.timing(rotate,     { toValue: -0.6, duration: N(0.3),  easing: easeOut, useNativeDriver: true }),
        Animated.timing(rotate,     { toValue:  0.8, duration: N(0.35), useNativeDriver: true }),
        Animated.timing(rotate,     { toValue:  0.2, duration: N(0.35), useNativeDriver: true }),
      ]),
    ];

    // 😮  burst scale (overshoot) then drift away
    case 'wow': return [
      Animated.sequence([
        Animated.timing(opacity,    { toValue: 1,    duration: N(0.08), useNativeDriver: true }),
        Animated.timing(opacity,    { toValue: 0,    duration: N(0.4),  delay: N(0.52), useNativeDriver: true }),
      ]),
      Animated.timing(translateX,   { toValue: dx,   duration: dur,     easing: easeOut, useNativeDriver: true }),
      Animated.timing(translateY,   { toValue: -dy,  duration: dur,     easing: easeOut, useNativeDriver: true }),
      Animated.sequence([
        Animated.spring(scale,      { toValue: 1.7,  speed: 80, bounciness: 2, useNativeDriver: true }),
        Animated.timing(scale,      { toValue: 0.45, duration: N(0.45), delay: N(0.3),  useNativeDriver: true }),
      ]),
    ];

    // 🔥  rapid scale flicker (simulates flame) while rising
    case 'fire':
    default: return [
      Animated.sequence([
        Animated.timing(opacity,    { toValue: 1,    duration: N(0.08), useNativeDriver: true }),
        Animated.timing(opacity,    { toValue: 0,    duration: N(0.35), delay: N(0.57), useNativeDriver: true }),
      ]),
      Animated.timing(translateX,   { toValue: dx,   duration: dur,     easing: easeOut, useNativeDriver: true }),
      Animated.timing(translateY,   { toValue: -dy,  duration: dur,     easing: easeOut, useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(scale,      { toValue: 1.3,  duration: N(0.12), useNativeDriver: true }),
        Animated.timing(scale,      { toValue: 0.85, duration: N(0.12), useNativeDriver: true }),
        Animated.timing(scale,      { toValue: 1.2,  duration: N(0.12), useNativeDriver: true }),
        Animated.timing(scale,      { toValue: 0.9,  duration: N(0.12), useNativeDriver: true }),
        Animated.timing(scale,      { toValue: 1.1,  duration: N(0.12), useNativeDriver: true }),
        Animated.timing(scale,      { toValue: 0.5,  duration: N(0.4),  useNativeDriver: true }),
      ]),
    ];
  }
}

// ── Overlay component ─────────────────────────────────────────────────────────

interface ParticleEntry {
  id:       number;
  burstId:  number;
  type:     ReactionType;
  size:     number;
  dx:       number;
  dy:       number;
  delay:    number;
  duration: number;
}

let _uid = 0;

interface Props {
  messageId: string;
  isMine?:   boolean;
}

export function ReactionBurstOverlay({ messageId, isMine = false }: Props) {
  const [particles, setParticles] = useState<ParticleEntry[]>([]);

  useEffect(() => {
    return reactionEmitter.on(messageId, (type) => {
      const cfg = CONFIGS[type];
      const burstId = ++_uid;
      const newParticles: ParticleEntry[] = Array.from({ length: cfg.count }, (_, i) => ({
        id:       ++_uid,
        burstId,
        type,
        size:     rand(cfg.minSize, cfg.maxSize),
        dx:       (Math.random() - 0.5) * 2 * cfg.dxRange,
        dy:       rand(cfg.dyRange[0], cfg.dyRange[1]),
        delay:    i * cfg.stagger,
        duration: cfg.duration - 80 + Math.random() * 160,
      }));
      setParticles(prev => [...prev, ...newParticles]);
    });
  }, [messageId]);

  const removeParticle = useCallback((id: number) => {
    setParticles(prev => prev.filter(p => p.id !== id));
  }, []);

  if (particles.length === 0) return null;

  return (
    <View
      style={[styles.overlay, isMine ? styles.right : styles.left]}
      pointerEvents="none"
    >
      {particles.map(p => (
        <Particle
          key={p.id}
          type={p.type}
          emoji={CONFIGS[p.type].emoji}
          size={p.size}
          dx={p.dx}
          dy={p.dy}
          delay={p.delay}
          duration={p.duration}
          onDone={() => removeParticle(p.id)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position:      'absolute',
    bottom:        16,
    pointerEvents: 'none',
    zIndex:        99,
  },
  left: {
    left: 44,   // aligns roughly with the bubble left edge (after avatar)
  },
  right: {
    right: 8,
  },
  particle: {
    position: 'absolute',
  },
});
