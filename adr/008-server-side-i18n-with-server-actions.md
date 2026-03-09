# ADR-008: Server-Side i18n with Server Actions

**Status:** Accepted
**Date:** 2025-12

### Context

React Server Components (RSC) render once on the server. Language switching is a client-side action. How do we make Server Components re-render with a new locale?

### Decision

Use **Server Actions + `revalidatePath()`** for language switching:

```
┌─────────────────────────────────────────────────────────────┐
│  1. Server reads locale from cookie                         │
│  2. Server initializes i18n with setI18n()                  │
│  3. Server Components use getLingui() → i18n._()            │
│  4. Client Components use useLingui() → reactive _()        │
│  5. Language switch: Server Action sets cookie + revalidates│
│  6. Next.js streams new Server Components to client         │
└─────────────────────────────────────────────────────────────┘
```

**File structure:**
```
src/lib/
  i18n.ts          # Shared: types, LOCALES, loadMessages()
  i18n.server.ts   # Server-only: getLocale(), initI18nServer()
  actions.ts       # Server Action: setLocaleAction()
```

**Server Component:**
```tsx
import { getLingui } from "@lingui/core/macro"
import { initI18nServer } from "@/lib/i18n.server"

export default async function Page() {
  await initI18nServer()
  const { t } = getLingui()
  return <h1>{t`Hello`}</h1>
}
```

**Server Action:**
```tsx
"use server"
import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"

export async function setLocaleAction(locale: string) {
  cookies().set("locale", locale, { path: "/", maxAge: 31536000 })
  revalidatePath("/", "layout")
}
```

**Client Component (Language Switcher):**
```tsx
"use client"
import { useTransition } from "react"
import { setLocaleAction } from "@/lib/actions"

function LanguageSwitcher() {
  const [isPending, startTransition] = useTransition()

  function handleChange(locale: string) {
    startTransition(async () => {
      setLocale(locale)           // Optimistic client update
      await setLocaleAction(locale) // Server: cookie + revalidate
    })
  }
}
```

### How RSC Streaming Works

When `revalidatePath()` is called:
1. Next.js re-renders affected Server Components
2. RSC payload is streamed to client (not full HTML)
3. React reconciles new server output with existing client state
4. Client state (e.g., counter value) is preserved
5. No full page reload, no JavaScript restart

### Alternatives Considered

1. **`router.refresh()`**: Works but less idiomatic than Server Actions
2. **URL-based locale (`/de/...`, `/en/...`)**: More explicit, better for SEO, but requires route restructuring
3. **Full page reload**: Works but loses client state

### Consequences

- ✅ Server Components properly re-render on language change
- ✅ Client state is preserved (RSC streaming)
- ✅ Optimistic UI updates with `useTransition()`
- ✅ Atomic operation (cookie + revalidation in one action)
- ⚠️ Requires `setI18n()` call in server code
- ⚠️ Small delay for server round-trip on language change

---
