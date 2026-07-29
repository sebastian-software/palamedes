import type { ComponentProps } from "react"

import { SiteLink } from "./SiteUiProvider"
import type { ButtonLinkProps, ButtonVariant } from "./types"

export function ButtonLink({
  variant = "primary",
  href,
  children,
  className = "",
  ariaLabel,
}: ButtonLinkProps) {
  return (
    <SiteLink
      href={href}
      ariaLabel={ariaLabel}
      className={`pmds-button pmds-button--${variant} ${className}`}
    >
      {children}
    </SiteLink>
  )
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: { variant?: ButtonVariant } & Omit<ComponentProps<"button">, "ref">) {
  return (
    <button
      type="button"
      className={`pmds-button pmds-button--${variant} ${className}`}
      {...props}
    />
  )
}
