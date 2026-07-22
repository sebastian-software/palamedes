import type { LoadedPalamedesConfig } from "@palamedes/config"

export declare const PALAMEDES_PLUGIN_API_VERSION: 1

export type PalamedesPluginDiagnostic = {
  severity: "info" | "warning" | "error"
  message: string
  code?: string
  details?: unknown
}

export type PalamedesPluginCatalog = {
  path: string
  format: "po" | "fcl"
  include: readonly string[]
  exclude: readonly string[]
  locales: readonly {
    locale: string
    path: string
  }[]
}

export type PalamedesBuiltInResult = {
  exitCode: number
}

export type PalamedesPluginHost = {
  readonly apiVersion: 1
  readonly config: LoadedPalamedesConfig
  catalogs(): readonly PalamedesPluginCatalog[]
  runBuiltIn(args: readonly string[]): Promise<PalamedesBuiltInResult>
  reportDiagnostic(diagnostic: PalamedesPluginDiagnostic): void
}

export type PalamedesPluginCommandContext<Options = unknown> = {
  readonly args: readonly string[]
  readonly options: Options
  readonly json: boolean
  readonly interactive: boolean
  readonly signal: AbortSignal
  readonly host: PalamedesPluginHost
}

export type PalamedesPluginCommandResult =
  | void
  | string
  | {
      exitCode?: number
      text?: string
      data?: unknown
      diagnostics?: readonly PalamedesPluginDiagnostic[]
    }

export type PalamedesPluginCommand<Options = unknown> = {
  description?: string
  run(
    context: PalamedesPluginCommandContext<Options>
  ): PalamedesPluginCommandResult | Promise<PalamedesPluginCommandResult>
}

export type PalamedesCliPlugin<Options = unknown> = {
  name: string
  apiVersion: 1
  commands: Record<string, PalamedesPluginCommand<Options>>
}

export declare function definePlugin<Options = unknown>(
  plugin: PalamedesCliPlugin<Options>
): PalamedesCliPlugin<Options>
