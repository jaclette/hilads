import type { User } from '@/types';

/**
 * Central access rule: can the current viewer access a registered user profile?
 *
 * Rule: ghost (guest) users cannot view registered profiles.
 * Registered users can always view any profile.
 *
 * This is the single source of truth — enforced on frontend AND backend.
 */
export function canAccessProfile(account: User | null): boolean {
  return account !== null;
}
