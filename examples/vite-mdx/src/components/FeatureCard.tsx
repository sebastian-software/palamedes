import type { PropsWithChildren } from "react"

type FeatureCardProps = PropsWithChildren<{
  title: string
}>

export function FeatureCard({ children, title }: FeatureCardProps) {
  return (
    <section className="feature-card">
      <p className="feature-card-title">{title}</p>
      <div>{children}</div>
    </section>
  )
}
