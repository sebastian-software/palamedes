import { useEffect, useRef, type RefObject } from "react";

import { SiteLink } from "./SiteUiProvider";
import type { SiteFamilyLine, SiteFamilyTool, SiteToolSwitcher } from "./types";

/**
 * A <details> flyout is not a modal dialog: it must still close on an outside
 * click and on Escape, and Escape has to return focus to the trigger. Without
 * JavaScript the element stays a working disclosure, which is why the switcher
 * is built on it rather than on a scripted popover.
 */
function useDismissible(ref: RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      const switcher = ref.current;
      const target = event.target;
      if (switcher?.open && target instanceof Node && !switcher.contains(target)) {
        switcher.removeAttribute("open");
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      const switcher = ref.current;
      if (event.key === "Escape" && switcher?.open) {
        switcher.removeAttribute("open");
        switcher.querySelector("summary")?.focus();
      }
    }

    document.addEventListener("click", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("click", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [ref]);
}

function FamilyToolLink({
  tool,
  className,
  withJob = false,
}: {
  tool: SiteFamilyTool;
  className: string;
  withJob?: boolean;
}) {
  return (
    <SiteLink
      href={tool.href}
      className={className}
      ariaCurrent={tool.current ? "page" : undefined}
    >
      <span className="pmds-family-name">{tool.label}</span>
      {withJob && tool.job ? <span className="pmds-family-job">{tool.job}</span> : null}
    </SiteLink>
  );
}

/**
 * The family-wide tool switcher. Data only: the consuming site resolves the
 * groups from the family registry, so this package keeps depending on React
 * alone (ADR-021) and Palamedes+ opts out by leaving `toolSwitcher` unset.
 */
export function ToolSwitcher({
  switcher,
  className = "",
}: {
  switcher: SiteToolSwitcher;
  className?: string;
}) {
  const switcherRef = useRef<HTMLDetailsElement>(null);
  useDismissible(switcherRef);

  return (
    <details ref={switcherRef} className={`pmds-switcher ${className}`}>
      <summary className="pmds-switcher-trigger">{switcher.label}</summary>
      {/*
       * role="group" rather than a bare <div>: aria-label is prohibited on a
       * generic element, and a second navigation landmark in the header would
       * compete with the site's own. A named group carries the same intent.
       */}
      <div
        className="pmds-switcher-flyout"
        role="group"
        aria-label={switcher.ariaLabel ?? switcher.label}
      >
        {switcher.groups.map((group) => (
          <div key={group.label} className="pmds-switcher-group">
            <p className="pmds-switcher-group-label">{group.label}</p>
            <ul className="pmds-switcher-list">
              {group.tools.map((tool) => (
                <li key={tool.href}>
                  <FamilyToolLink tool={tool} className="pmds-switcher-link" withJob />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}

/** One-line family credit for the footer, ending at the family site. */
export function FamilyLine({ line, className = "" }: { line: SiteFamilyLine; className?: string }) {
  return (
    <div className={`pmds-family-line ${className}`}>
      <SiteLink href={line.href} className="pmds-family-line-label">
        {line.label}
      </SiteLink>
      <ul className="pmds-family-line-list">
        {line.tools.map((tool) => (
          <li key={tool.href}>
            <FamilyToolLink tool={tool} className="pmds-family-line-link" />
          </li>
        ))}
      </ul>
    </div>
  );
}
