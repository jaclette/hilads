import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Photo location privacy (2026-11-20): where a Daily photo shows.
 *   exact - pinned on its place (a public café or restaurant), as before;
 *   area  - around its neighbourhood (the server keeps only a ~400 m cell, never the spot);
 *   city  - counts for the city, not on the Map (no position at all).
 * The default (Settings › Photo location) applies to every post and can be changed on each.
 * Privacy first: Neighbourhood until the person picks something else.
 */
export type PhotoPrecision = 'exact' | 'area' | 'city';
export const PRECISIONS: PhotoPrecision[] = ['exact', 'area', 'city'];
export const DEFAULT_PRECISION: PhotoPrecision = 'area';

const KEY = 'hilads_photo_location_v1';

export async function getPhotoPrecision(): Promise<PhotoPrecision> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v === 'exact' || v === 'area' || v === 'city' ? v : DEFAULT_PRECISION;
  } catch {
    return DEFAULT_PRECISION;
  }
}

export async function setPhotoPrecision(p: PhotoPrecision): Promise<void> {
  await AsyncStorage.setItem(KEY, p).catch(() => {});
}

export const PRECISION_ICON: Record<PhotoPrecision, 'location' | 'navigate-circle-outline' | 'business-outline'> = {
  exact: 'location',
  area:  'navigate-circle-outline',
  city:  'business-outline',
};
