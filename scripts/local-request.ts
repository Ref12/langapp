import type { IncomingMessage } from 'node:http'
import { LOOPBACK_HOSTNAMES } from '../src/core/assistant/contracts'

const localAddresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

type LocalRequest = Pick<IncomingMessage, 'headers'> & {
  socket: Pick<IncomingMessage['socket'], 'remoteAddress'>
}

export function isLocalRequest(request: LocalRequest, protocol: string, header: string): boolean {
  if (!localAddresses.has(request.socket.remoteAddress ?? '')
    || request.headers[header] !== '1') return false
  let origin: URL
  try {
    origin = new URL(`${protocol}://${request.headers.host}`)
  } catch {
    return false
  }
  return LOOPBACK_HOSTNAMES.includes(origin.hostname) && !origin.username && !origin.password
    && (!request.headers.origin || request.headers.origin === origin.origin)
    && (!request.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(String(request.headers['sec-fetch-site'])))
}
