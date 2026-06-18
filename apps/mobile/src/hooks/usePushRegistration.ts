/**
 * Global push registration hook - always mounted in the root layout.
 *
 * Triggers push token registration whenever an authenticated account becomes
 * available, regardless of HOW it was obtained:
 *   - app boot with a restored session (SecureStore token)
 *   - fresh sign-in
 *   - fresh sign-up
 *
 * This is the canonical push registration trigger. The sign-in/sign-up
 * screen calls are kept as belt-and-suspenders, but this hook is the
 * guarantee that push registration fires for every authenticated user.
 */
import { useEffect, useRef } from 'react';
import { useApp } from '@/context/AppContext';
import { requestAndRegisterPush } from '@/services/push';
import { getAuthToken } from '@/api/client';
import { API_URL } from '@/constants';

// ── Module-level proof of import ──────────────────────────────────────────────
// Runs ONCE when the JS bundle evaluates this module.
// If this never appears in logs, the file is not imported at all.
console.log('[push-reg] ── MODULE LOADED ─────────────────────────────────────');

export function usePushRegistration(): void {
  const { account, identity } = useApp();

  // Prevent re-registering for the same identity within one app session.
  // Keyed by account id (so a logout→login of a different account re-registers)
  // or, for guests, the guest device id (so unregistered installs register too).
  const lastRegisteredFor = useRef<string | null>(null);

  // ── Mount proof - fires exactly once when this hook is first rendered ───────
  // If this never appears, the hook is not in the mounted component tree.
  useEffect(() => {
    console.log('[push-reg] ── HOOK MOUNTED ──────────────────────────────────');
    console.log('[push-reg] API_URL at mount =', API_URL);
    console.log('[push-reg] authToken at mount =',
      getAuthToken() !== null ? `yes (${getAuthToken()!.length} chars)` : 'NO');
  }, []);

  // ── Account change effect - fires on mount and whenever account.id changes ──
  useEffect(() => {
    console.log('[push-reg] ── account effect fired ─────────────────────────');
    console.log('[push-reg] account =', account ? `id=${account.id} name=${account.display_name}` : 'null');
    console.log('[push-reg] lastRegisteredFor =', lastRegisteredFor.current ?? 'null');
    console.log('[push-reg] API_URL =', API_URL);
    console.log('[push-reg] authToken present =',
      getAuthToken() !== null ? `yes (${getAuthToken()!.length} chars)` : 'NO');

    const guestId = identity?.guestId ?? null;
    // Registration key: the account when signed in (so a different login
    // re-registers), else the guest device. Guests register on app open so the
    // BO can broadcast to unregistered installs ("all app installs").
    const key = account?.id ? `user:${account.id}` : (guestId ? `guest:${guestId}` : null);

    if (!key) {
      console.log('[push-reg] no account and no guest id yet - skipping push registration');
      return;
    }

    if (lastRegisteredFor.current === key) {
      console.log('[push-reg] guard: already registered for this identity this session - skipping');
      return;
    }

    console.log('[push-reg] NEW identity detected - starting push registration for', key);

    // Always pass guestId so the token row carries the device's guest session
    // (alongside user_id when signed in). NOTE: guard is set ONLY after success
    // so a failed attempt retries on the next trigger.
    requestAndRegisterPush(guestId)
      .then(() => {
        console.log('[push-reg] SUCCESS - marking session as registered for', key);
        lastRegisteredFor.current = key;
      })
      .catch(err => {
        console.warn('[push-reg] registration failed - will NOT mark session; will retry on next trigger:', String(err));
        // intentionally NOT setting lastRegisteredFor so the next trigger retries
      });
  }, [account?.id, identity?.guestId]);
}
