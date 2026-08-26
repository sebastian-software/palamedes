import { useNavigate } from "@solidjs/router"
import { DEFAULT_LOCALE } from "../lib/i18n"

export default function IndexPage() {
  const navigate = useNavigate()
  navigate(`/${DEFAULT_LOCALE}`, { replace: true })
  return null
}
