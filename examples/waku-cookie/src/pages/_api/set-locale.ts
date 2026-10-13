import { locales, resolveCookieLocale } from "../../lib/i18n";

export async function POST(request: Request): Promise<Response> {
  const formData = await request.formData();
  const locale = locales.normalizeLocale(formData.get("locale"));
  const location = new URL("/", request.url);
  const resolved = resolveCookieLocale(Object.fromEntries(request.headers));
  const headers = new Headers({ Location: location.toString() });
  if (resolved.source !== "cookie" || resolved.locale !== locale) {
    headers.set("Set-Cookie", `locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`);
  }

  return new Response(null, {
    status: 303,
    headers,
  });
}
