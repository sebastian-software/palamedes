import { Navigate } from "@solidjs/router"
import { DEFAULT_LOCALE } from "../lib/i18n"

export default function IndexPage() {
  return <Navigate href={`/${DEFAULT_LOCALE}`} />
}
