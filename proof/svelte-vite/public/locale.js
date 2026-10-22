const requestedLocale = new URLSearchParams(location.search).get("locale");
document.documentElement.lang = ["en", "de", "fr", "es"].includes(requestedLocale)
  ? requestedLocale
  : "en";
