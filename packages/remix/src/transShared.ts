import {
  createCompiledMessageRuntime,
  formatMessageArgument,
  replacePoundPlaceholders,
  stringifyValue,
} from "@palamedes/core/internal";
import type {
  CompiledMessageRuntime,
  MessageMetadata,
  PalamedesI18n,
} from "@palamedes/core/compiled";
import { createElement, type Handle, type RemixElement, type RemixNode } from "remix/component";

/**
 * Props of the compiled runtime `Trans` component. The Palamedes transform
 * emits these from authored `Trans` macros; application code imports `Trans`
 * from the `/macro` entry instead.
 */
export type TransProps = {
  /** Compiled lookup key injected by the transform. */
  id: string;
  /** Authored source message, kept only as diagnostic metadata. */
  message?: string;
  context?: string;
  comment?: string;
  values?: Record<string, unknown>;
  components?: Record<string, RemixElement>;
};

type RendererI18n = Pick<PalamedesI18n, "locale" | "timeZone" | "renderMessage">;
type ResettableRemixMessageRuntime = {
  reset: (components: Record<string, RemixElement>) => void;
  runtime: CompiledMessageRuntime<RemixNode[]>;
};
type CachedRemixMessageRuntime = ResettableRemixMessageRuntime & {
  inUse: boolean;
  locale: string;
  timeZone: string | undefined;
};

const EMPTY_COMPONENTS: Record<string, RemixElement> = Object.freeze({});
const EMPTY_VALUES: Record<string, unknown> = Object.freeze({});

/** Creates a Remix UI component factory for package-root and compiled entries. */
export function createTrans(useI18n: () => RendererI18n) {
  const runtimeCache = createRemixMessageRuntimeCache();

  return function Trans(handle: Handle<TransProps>) {
    return (): RemixNode => {
      const { id, message, values, components, context, comment } = handle.props;
      const i18n = useI18n();
      const metadata: MessageMetadata = {
        message,
        context,
        comment,
      };
      const lease = runtimeCache.acquire(i18n, components ?? EMPTY_COMPONENTS);
      try {
        return renderI18nMessage(i18n, id, values ?? EMPTY_VALUES, lease.runtime, metadata);
      } finally {
        runtimeCache.release(lease);
      }
    };
  };
}

export function createRemixMessageRuntimeCache() {
  // Cache one idle renderer per i18n instance. Nested synchronous renders get a
  // temporary renderer so they cannot overwrite an outer render's components
  // or keys. Weak keys keep request-scoped instances collectable.
  const cache = new WeakMap<RendererI18n, CachedRemixMessageRuntime>();

  return {
    acquire(
      i18n: RendererI18n,
      components: Record<string, RemixElement>,
    ): CachedRemixMessageRuntime {
      let cached = cache.get(i18n);
      if (
        cached === undefined ||
        cached.inUse ||
        cached.locale !== i18n.locale ||
        cached.timeZone !== i18n.timeZone
      ) {
        const canCache = cached?.inUse !== true;
        cached = {
          ...createResettableRemixMessageRuntime(i18n, components),
          locale: i18n.locale,
          timeZone: i18n.timeZone,
          inUse: false,
        };
        if (canCache) cache.set(i18n, cached);
      }
      cached.inUse = true;
      cached.reset(components);
      return cached;
    },
    release(cached: CachedRemixMessageRuntime): void {
      // Do not keep the last rendered Remix elements and their props alive.
      cached.reset(EMPTY_COMPONENTS);
      cached.inUse = false;
    },
  };
}

export function renderI18nMessage(
  i18n: RendererI18n,
  id: string,
  values: Record<string, unknown>,
  runtime: CompiledMessageRuntime<RemixNode[]>,
  metadata: MessageMetadata,
): RemixNode[] {
  return i18n.renderMessage(id, values, runtime, metadata);
}

export function createRemixMessageRuntime(
  i18n: RendererI18n,
  components: Record<string, RemixElement>,
): CompiledMessageRuntime<RemixNode[]> {
  return createResettableRemixMessageRuntime(i18n, components).runtime;
}

function createResettableRemixMessageRuntime(
  i18n: RendererI18n,
  components: Record<string, RemixElement>,
): ResettableRemixMessageRuntime {
  const locale = i18n.locale;
  const timeZone = i18n.timeZone;
  let currentComponents = components;
  let nextKey = 0;
  const runtime: CompiledMessageRuntime<RemixNode[]> = createCompiledMessageRuntime<RemixNode[]>(
    locale,
    {
      join(...parts) {
        return parts.flatMap((part) => (typeof part === "string" ? [part] : part));
      },
      value(value) {
        return renderVariable(value);
      },
      number(value, style) {
        return [formatMessageArgument("number", value, style, locale)];
      },
      date(value, style) {
        return [formatMessageArgument("date", value, style, locale, timeZone)];
      },
      time(value, style) {
        return [formatMessageArgument("time", value, style, locale, timeZone)];
      },
      pound(value) {
        return [replacePoundPlaceholders("#", value, locale)];
      },
      literal(value) {
        return [value];
      },
      tag(name, children) {
        const component = currentComponents[name];
        if (isRemixElement(component)) {
          return [
            createElement(component.type, { ...component.props, key: nextKey++ }, ...children),
          ];
        }
        return children;
      },
    },
  );

  return {
    reset(nextComponents) {
      currentComponents = nextComponents;
      nextKey = 0;
    },
    runtime,
  };
}

function renderVariable(value: unknown): RemixNode[] {
  if (Array.isArray(value)) {
    return value.flatMap(renderVariable);
  }
  if (isRemixElement(value)) {
    return [value];
  }
  return [stringifyValue(value)];
}

function isRemixElement(value: unknown): value is RemixElement {
  const element = value as Partial<RemixElement> | null;
  return (
    typeof element === "object" &&
    element !== null &&
    element.$rmx === true &&
    (typeof element.type === "string" || typeof element.type === "function") &&
    typeof element.props === "object" &&
    element.props !== null
  );
}
