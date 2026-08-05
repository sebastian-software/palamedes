"use client"

import { use } from "react"
import { t } from "@palamedes/core/macro"
import type { Locale } from "@/lib/i18n"

const browserReady = Promise.resolve()
const serverResources = new WeakMap<object, Promise<void>>()

function getSuspensionResource(token: object): Promise<void> {
  if (typeof window !== "undefined") return browserReady

  let resource = serverResources.get(token)
  if (!resource) {
    resource = new Promise((resolve) => setTimeout(resolve, 25))
    serverResources.set(token, resource)
  }
  return resource
}

export function ScopeSuspensionProbe({
  locale,
  suspensionToken,
}: {
  locale: Locale
  suspensionToken: object
}) {
  use(getSuspensionResource(suspensionToken))
  return <output data-probe-locale={locale}>{t`More tickets`}</output>
}
