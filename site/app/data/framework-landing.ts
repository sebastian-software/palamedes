export interface FrameworkLandingLink {
  label: string
  href: string
}

export interface FrameworkLandingPoint {
  title: string
  body: string
}

export interface FrameworkLandingFact {
  label: string
  value: string
  note: string
}

export interface FrameworkLandingFaq {
  q: string
  a: string
}

export interface FrameworkLanding {
  name: string
  path: string
  eyebrow: string
  metaTitle: string
  metaDescription: string
  headline: string
  lede: string
  primary: FrameworkLandingLink
  secondary: FrameworkLandingLink
  facts: FrameworkLandingFact[]
  problem: {
    title: string
    lede: string
    points: string[]
  }
  approach: {
    title: string
    lede: string
    points: FrameworkLandingPoint[]
  }
  code: {
    label: string
    caption: string
    source: string
    note: string
  }
  strategies: {
    lede: string
    matrixSlug?: string
  }
  proof: {
    title: string
    lede: string
    facts: FrameworkLandingFact[]
  }
  boundary: {
    title: string
    body: string
    link?: FrameworkLandingLink
  }
  faq: FrameworkLandingFaq[]
  related: FrameworkLandingLink[]
  finalCta: {
    headline: string
    primary: FrameworkLandingLink
    secondary: FrameworkLandingLink
  }
}
