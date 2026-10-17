/** Join class names, skipping empty values (the shadcn `cn` helper, minus Tailwind merging). */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
