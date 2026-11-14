export function resolveLocale({ pathname, search, languages }) {
  const pathLocale = pathname.split("/")[1];
  if (["en", "de"].includes(pathLocale)) return pathLocale;
  const queryLocale = new URLSearchParams(search).get("lang");
  if (["en", "de"].includes(queryLocale)) return queryLocale;
  return languages.some((language) => language.toLowerCase().startsWith("de")) ? "de" : "en";
}
