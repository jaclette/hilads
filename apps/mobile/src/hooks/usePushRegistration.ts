/**
 * Global push registration hook — always mounted in the root layout.
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

export function usePushRegistration(): void {
  const { account } = useApp();

  // Prevent re-registering for the same user within one app session.
  // Uses user ID so a logout→login of a different account re-registers.
  const lastRegisteredFor = useRef<string | null>(null);

  useEffect(() => {
    console.log('[push-reg] ── effect fired ──────────────────────────────────');
    console.log('[push-reg] account =', account ? `id=${account.id} name=${account.display_name}` : 'null');
    console.log('[push-reg] API_URL =', API_URL);
    console.log('[push-reg] authToken present =',
      getAuthToken() !== null ? `yes (${getAuthToken()!.length} chars)` : 'NO');

    if (!account) {
      console.log('[push-reg] no account — skipping push registration');
      return;
    }

    if (lastRegisteredFor.current === account.id) {
      console.log('[push-reg] already registered for this user this session — skipping');
      return;
    }

    lastRegisteredFor.current = account.id;

    console.log('[push-reg] NEW account detected — starting push registration for', account.id);

    requestAndRegisterPush().catch(err =>
      console.warn('[push-reg] registration failed:', String(err)),
    );
  }, [account?.id]);
}
