document.documentElement.lang =
  new URLSearchParams(location.search).get("locale") === "de" ? "de" : "en";
