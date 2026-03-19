function throwMacroError(): never {
  throw new Error(
    "The macro you imported from @palamedes/react/macro is being executed outside the compiler transform. Configure a Palamedes plugin before this code runs."
  )
}

export function Trans(_props: any): never {
  return throwMacroError()
}

export function Plural(_props: any): never {
  return throwMacroError()
}

export function Select(_props: any): never {
  return throwMacroError()
}

export function SelectOrdinal(_props: any): never {
  return throwMacroError()
}
