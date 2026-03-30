function macroError(): never {
  throw new Error(
    "The macro you imported from @palamedes/solid/macro is being executed outside the compiler transform. Configure a Palamedes plugin before this code runs."
  )
}

export function Trans(_props: any): never {
  return macroError()
}

export function Plural(_props: any): never {
  return macroError()
}

export function Select(_props: any): never {
  return macroError()
}

export function SelectOrdinal(_props: any): never {
  return macroError()
}
