// Invitations (scoring v2). A visit with ?ref=CODE (the /today landing's "Sign up on the web"
// passes it through /?auth=signup) keeps the code for this browser session; the sign-up sends it
// as invite_code and the server credits the inviter once the friend's first photo is approved.
const KEY = 'hilads_invite_code'

export function captureInviteRef() {
  try {
    const ref = new URLSearchParams(window.location.search).get('ref')
    if (ref && /^[A-Za-z0-9]{5,12}$/.test(ref)) sessionStorage.setItem(KEY, ref.toUpperCase())
  } catch { /* storage off */ }
}

export function pendingInvite() {
  try { return sessionStorage.getItem(KEY) } catch { return null }
}

export function clearPendingInvite() {
  try { sessionStorage.removeItem(KEY) } catch { /* storage off */ }
}
