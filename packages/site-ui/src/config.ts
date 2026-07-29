import type { SiteConfig } from "./types"

/*
 * Keeps configuration at the consuming site boundary. In particular, a
 * counterpart link is data rather than an environment check hidden inside
 * shared chrome, so palamedes.dev and plus.palamedes.dev can roll out links
 * independently and test the exact state they intend to ship.
 */
export function defineSiteConfig(config: SiteConfig): SiteConfig {
  return config
}
