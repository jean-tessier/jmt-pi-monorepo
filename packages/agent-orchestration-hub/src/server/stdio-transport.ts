import { createInterface } from 'node:readline'
import type { Request } from './protocol.js'
import type { RequestHandler } from './request-handler.js'

export class StdioTransport {
  private readonly handler: RequestHandler
  private readonly input: NodeJS.ReadableStream
  private readonly output: NodeJS.WritableStream

  constructor(
    handler: RequestHandler,
    input: NodeJS.ReadableStream = process.stdin,
    output: NodeJS.WritableStream = process.stdout,
  ) {
    this.handler = handler
    this.input = input
    this.output = output
  }

  start(): void {
    const rl = createInterface({ input: this.input, terminal: false })

    rl.on('line', (line) => {
      const trimmed = line.trim()
      if (!trimmed) return

      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        const errorResponse = JSON.stringify({
          id: null,
          error: { code: -32700, message: 'Parse error' },
        })
        this.output.write(errorResponse + '\n')
        return
      }

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof (parsed as Record<string, unknown>)['id'] !== 'string' ||
        typeof (parsed as Record<string, unknown>)['method'] !== 'string'
      ) {
        const id =
          typeof (parsed as Record<string, unknown>)?.['id'] === 'string'
            ? (parsed as Record<string, unknown>)['id']
            : null
        const errorResponse = JSON.stringify({
          id,
          error: { code: -32600, message: 'Invalid Request' },
        })
        this.output.write(errorResponse + '\n')
        return
      }

      const request = parsed as Request
      const response = this.handler.handle(request)
      this.output.write(JSON.stringify(response) + '\n')
    })
  }
}
