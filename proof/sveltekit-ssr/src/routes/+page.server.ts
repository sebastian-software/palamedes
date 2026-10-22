import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ fetch, locals, url }) => {
  const delay = url.searchParams.get("delay") ?? "0";
  const response = await fetch(`/api/proof?locale=${locals.locale}&delay=${delay}`);
  if (!response.ok) throw new Error("Server query failed");
  return { proof: (await response.json()) as { message: string } };
};
