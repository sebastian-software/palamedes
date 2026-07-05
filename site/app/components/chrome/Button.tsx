import type { ComponentProps, ReactNode } from "react"
import { Link } from "react-router"

type Variant = "primary" | "outline" | "small"

const styles: Record<Variant, string> = {
  primary:
    "inline-block bg-accent px-6 py-3 font-mono text-[11px] font-medium tracking-label text-white uppercase hover:bg-ink",
  outline:
    "inline-block border border-ink px-6 py-3 font-mono text-[11px] font-medium tracking-label text-ink uppercase hover:bg-ink hover:text-paper",
  small:
    "inline-block border border-ink px-4 py-2 font-mono text-[11px] font-medium tracking-label text-ink uppercase hover:bg-ink hover:text-paper",
}

interface ButtonLinkProps {
  variant?: Variant
  href: string
  children: ReactNode
  className?: string
}

/* External links render <a>, internal paths render a view-transitioning <Link>. */
export function ButtonLink({
  variant = "primary",
  href,
  children,
  className = "",
}: ButtonLinkProps) {
  const classes = `${styles[variant]} ${className} transition-colors`
  if (href.startsWith("/")) {
    return (
      <Link to={href} viewTransition className={classes}>
        {children}
      </Link>
    )
  }
  return (
    <a href={href} className={classes}>
      {children}
    </a>
  )
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: { variant?: Variant } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={`${styles[variant]} ${className} transition-colors`}
      {...props}
    />
  )
}
