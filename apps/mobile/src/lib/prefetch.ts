import { Image } from 'expo-image';
import { mediumUrl } from '@/lib/imageThumb';
import type { DailyChallenge, DailyProof } from '@/types';

// What a full-screen viewer loads (DualPhoto: the medium size of the photo and of its selfie),
// warmed into memory before the viewer opens: on a press-in, or for the next stories.
const asked = new Set<string>();

/** Prefetch the viewer size of these originals (photo, selfie…); each URL once per session. */
export function prefetchFull(...originals: (string | null | undefined)[]): void {
  const urls = originals.map(u => mediumUrl(u) ?? u).filter((u): u is string => !!u && !asked.has(u));
  if (!urls.length) return;
  urls.forEach(u => asked.add(u));
  Image.prefetch(urls, 'memory-disk').catch(() => urls.forEach(u => asked.delete(u)));
}

/** A Daily photo's viewer images: the photo and its selfie. */
export function prefetchProof(p: { photoUrl?: string | null; selfieUrl?: string | null } | null | undefined): void {
  if (p) prefetchFull(p.photoUrl, p.selfieUrl);
}

// A photo tapped in a grid, handed to the screen that opens on it: its first frame shows it at
// once (from this object and the warm image cache) instead of a loader until the network answers.
const handed = new Map<string, DailyProof>();
export function handOffProof(p: DailyProof): void { handed.set(p.id, p); }
export function takeHandedProof(id: string | null | undefined): DailyProof | null {
  if (!id) return null;
  const p = handed.get(id) ?? null;
  handed.delete(id);
  return p;
}

// A list of photos handed to the photo feed, which plays it in that order (a ranking, a day's or a
// profile's photos), with their challenge when it isn't today's (to share them).
let handedList: { key: string; proofs: DailyProof[]; challenge: DailyChallenge | null } | null = null;
export function handOffList(key: string, proofs: DailyProof[], challenge: DailyChallenge | null = null): void { handedList = { key, proofs, challenge }; }
/** The challenge handed with the list under `key`, or null. */
export function takeHandedChallenge(key: string | null | undefined): DailyChallenge | null {
  return key && handedList?.key === key ? handedList.challenge : null;
}
/** The list handed under `key`, or null. Kept (not cleared) so a double render (StrictMode) reads it too; the next hand-off replaces it. */
export function takeHandedList(key: string | null | undefined): DailyProof[] | null {
  return key && handedList?.key === key ? handedList.proofs : null;
}
