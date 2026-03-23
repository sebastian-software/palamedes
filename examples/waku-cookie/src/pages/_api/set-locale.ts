import { normalizeLocale } from "@palamedes/example-locale-shared"

export async function POST(request: Request): Promise<Response> {
  const formData = await request.formData()
  const locale = normalizeLocale(formData.get("locale"))
  const location = new URL("/", request.url)

  return new Response(null, {
    status: 303,
    headers: {
      Location: location.toString(),
      "Set-Cookie": `locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`,
    },
  })
}
