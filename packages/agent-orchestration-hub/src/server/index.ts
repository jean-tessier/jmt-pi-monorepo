export { Hub } from './hub.js'
export type { HubOptions } from './hub.js'
export { StdioTransport } from './stdio-transport.js'
export { RequestHandler } from './request-handler.js'
export { HeartbeatTicker } from './heartbeat-ticker.js'
export type { Request, Response } from './protocol.js'

import { Hub } from './hub.js'
import { RequestHandler } from './request-handler.js'
import { StdioTransport } from './stdio-transport.js'
import { HeartbeatTicker } from './heartbeat-ticker.js'

export function startServer(): void {
  const hub = new Hub()
  const handler = new RequestHandler(hub)
  const transport = new StdioTransport(handler)
  const ticker = new HeartbeatTicker(hub.registry)
  ticker.start()
  transport.start()
}
