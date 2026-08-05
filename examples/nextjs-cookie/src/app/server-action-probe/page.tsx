import { redirectServerActionProof } from "@/lib/actions"

type ServerActionProbeProps = {
  searchParams: Promise<{ locale?: string; message?: string }>
}

export default async function ServerActionProbe({ searchParams }: ServerActionProbeProps) {
  const { locale, message } = await searchParams

  return (
    <main>
      <form action={redirectServerActionProof}>
        <button type="submit">Run Server Action</button>
      </form>
      <output data-action-locale={locale ?? "pending"}>{message ?? "pending"}</output>
    </main>
  )
}
