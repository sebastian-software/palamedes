/*
 * The site's light palette and type, as concrete values: CSS variables from
 * the site do not exist inside a render. Cinzel Hellenic ships as a file in
 * public/fonts; the sans and mono stacks resolve to macOS system fonts on the
 * render machine (Helvetica Neue, Menlo).
 */
export const C = {
  paper: "#faf9f4",
  parchment: "#f3efe3",
  mist: "#e8edf2",
  mistDeep: "#d6dee7",
  listing: "#f4f6f8",
  ink: "#0e2a4d",
  slate: "#4f6074",
  hair: "#ddd6c6",
  bronze: "#866026",
  gold: "#bc8a45",
  gray: "#6f695b",
  white: "#ffffff",
};

export const FONT = {
  display: '"Cinzel Hellenic", "Times New Roman", serif',
  sans: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  mono: 'Menlo, "SF Mono", ui-monospace, monospace',
};
