const requestedLocale = new URLSearchParams(location.search).get("locale");
document.documentElement.lang = ["en", "fr", "es"].includes(requestedLocale)
  ? requestedLocale
  : "en";
