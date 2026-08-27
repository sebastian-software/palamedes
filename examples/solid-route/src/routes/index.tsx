import { createEffect } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { DEFAULT_LOCALE } from "../lib/i18n"

export default function IndexPage() {
  const navigate = useNavigate()
  const target = `/${DEFAULT_LOCALE}`

  // Document requests redirect in middleware. This keeps client-side
  // navigation to the index route aligned with the same canonical URL.
  createEffect(
    () => target,
    (path) => navigate(path, { replace: true })
  )

  return <a href={target}>Continue to the default locale</a>
}
