function throwMacroError(): never {
  throw new Error(
    "The macro you imported from @palamedes/core/macro is being executed outside the compiler transform. Configure a Palamedes plugin before this code runs."
  )
}

export function t(..._args: any[]): string {
  return throwMacroError()
}

export function plural(..._args: any[]): string {
  return throwMacroError()
}

export function select(..._args: any[]): string {
  return throwMacroError()
}

export function selectOrdinal(..._args: any[]): string {
  return throwMacroError()
}
