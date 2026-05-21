/**
 * Avatar colors — single source of truth for generated (initial) avatars.
 *
 * One warm, on-brand palette shared across every screen so avatars stay
 * consistent app-wide. Replaces the ~11 duplicated AVATAR_PALETTE / AVATAR_BG
 * copies that had drifted (and included cold cyan/blue/green tones that clashed
 * with the warm orange/dark brand).
 *
 *   avatarGradient(name) → [start, end]  for LinearGradient avatars
 *   avatarColor(name)    → start         for flat solid-fill avatars
 *
 * Both are deterministic on `name`, so the same person always gets the same
 * color, and the flat color is the gradient's start stop so the two stay in
 * the same family.
 */

// Warm tones only — terracotta / amber / clay / gold / warm rose. No cold hues.
const AVATAR_GRADIENTS: readonly (readonly [string, string])[] = [
  ['#E0683C', '#C24A38'], // orange → terracotta (brand)
  ['#D98324', '#B87228'], // amber → bronze (brand)
  ['#C2566E', '#9E3B53'], // warm rose
  ['#B5563F', '#8F3B2E'], // brick
  ['#E0A33C', '#C2782A'], // gold → burnt amber
  ['#C76B4A', '#A84A36'], // clay
  ['#D4663C', '#B5432E'], // pumpkin
  ['#B8794A', '#946033'], // warm taupe
];

function hashName(name: string): number {
  const s = name ?? '';
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i);
  return sum;
}

export function avatarGradient(name: string): readonly [string, string] {
  return AVATAR_GRADIENTS[hashName(name) % AVATAR_GRADIENTS.length];
}

export function avatarColor(name: string): string {
  return avatarGradient(name)[0];
}
