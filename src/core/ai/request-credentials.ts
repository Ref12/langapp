/**
 * Browser credentials policy for AI requests: never send cookies to another origin, but let a same-origin
 * endpoint (hexad's gateway on the host that serves this app) receive the page's own sign-in cookie.
 */
export function requestCredentials(url: string): RequestCredentials {
  try {
    if (typeof location === 'undefined') return 'omit'
    return new URL(url, location.href).origin === location.origin ? 'same-origin' : 'omit'
  } catch { return 'omit' }
}
