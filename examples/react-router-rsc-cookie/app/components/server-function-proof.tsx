"use client"

import { useState, useTransition } from "react"

import { readLocalizedServerFunction } from "../lib/server-function"

type Proof = Awaited<ReturnType<typeof readLocalizedServerFunction>>

export function ServerFunctionProof() {
  const [proof, setProof] = useState<Proof | null>(null)
  const [isPending, startTransition] = useTransition()

  function runProof() {
    startTransition(async () => {
      setProof(await readLocalizedServerFunction())
    })
  }

  return (
    <section>
      <button
        data-testid="server-function-trigger"
        disabled={isPending}
        onClick={runProof}
        type="button"
      >
        Run RSC Server Function
      </button>
      <output data-testid="server-function-direct">{proof?.direct ?? "waiting"}</output>
      <output data-testid="server-function-sync">{proof?.synchronous ?? "waiting"}</output>
      <output data-testid="server-function-async">{proof?.asynchronous ?? "waiting"}</output>
      <output data-testid="server-function-cross-module">{proof?.crossModule ?? "waiting"}</output>
      <output data-testid="server-function-default">{proof?.defaultParameter ?? "waiting"}</output>
    </section>
  )
}
