import type { ServiceRegistry } from '../lib/registry/service-registry.js'

export class HeartbeatTicker {
  private readonly registry: ServiceRegistry
  private readonly intervalMs: number
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(registry: ServiceRegistry, intervalMs = 5_000) {
    this.registry = registry
    this.intervalMs = intervalMs
  }

  start(): void {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => {
      this.registry.checkForLostServices(Date.now())
    }, this.intervalMs)
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }
}
