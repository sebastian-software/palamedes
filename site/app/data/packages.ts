/*
 * Open-source package strip (V7 "CLI and repo ownership" element), sourced
 * from the README's recommended-packages table. Only real, published scoped
 * packages — the top-level `palamedes` name is reserved and deliberately
 * absent.
 */

export interface PackageCard {
  name: string
  role: string
}

export const PACKAGES: PackageCard[] = [
  { name: "@palamedes/cli", role: "Extraction CLI for workflows and CI" },
  { name: "@palamedes/core", role: "App-facing i18n instance" },
  { name: "@palamedes/runtime", role: "Runtime bridge for transformed code" },
  { name: "@palamedes/react", role: "React translation components" },
  { name: "@palamedes/solid", role: "Solid translation components" },
  { name: "@palamedes/vite-plugin", role: "Recommended Vite entry point" },
  { name: "@palamedes/next-plugin", role: "Recommended Next.js entry point" },
]
