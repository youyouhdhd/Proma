/** MCP Server 请求认证（bearer token；无认证配置时放行） */

import { timingSafeEqual, createHash } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import type { PromaMcpServerConfig } from '@proma/shared'

export function isRequestAuthorized(
  auth: PromaMcpServerConfig['auth'],
  authorizationHeader: IncomingHttpHeaders['authorization'],
): boolean {
  if (auth.type !== 'bearer') return true
  const provided = typeof authorizationHeader === 'string' ? authorizationHeader : ''
  const match = /^Bearer\s+(.+)$/.exec(provided)
  if (!match) return false
  const expected = createHash('sha256').update(auth.token ?? '').digest()
  const actual = createHash('sha256').update(match[1] ?? '').digest()
  return timingSafeEqual(expected, actual)
}
