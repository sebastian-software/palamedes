import { createContext, useContext, type ComponentType } from "react";

import type { SiteLinkComponentProps, SiteUiProviderProps } from "./types";

function AnchorLink({ href, className, children, ariaLabel, ariaCurrent }: SiteLinkComponentProps) {
  return (
    <a href={href} className={className} aria-label={ariaLabel} aria-current={ariaCurrent}>
      {children}
    </a>
  );
}

const LinkContext = createContext<ComponentType<SiteLinkComponentProps>>(AnchorLink);

export function SiteUiProvider({ children, linkComponent = AnchorLink }: SiteUiProviderProps) {
  const LinkComponent = linkComponent;
  return <LinkContext.Provider value={LinkComponent}>{children}</LinkContext.Provider>;
}

export function SiteLink(props: SiteLinkComponentProps) {
  const LinkComponent = useContext(LinkContext);
  return <LinkComponent {...props} />;
}
