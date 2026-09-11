import * as React from "react";
import { cloneElement, Fragment, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";

import {
  createCompiledMessageRuntime,
  formatMessageArgument,
  replacePoundPlaceholders,
  stringifyValue,
} from "@palamedes/core/compiled";
import type {
  CompiledMessageRuntime,
  MessageMetadata,
  PalamedesI18n,
} from "@palamedes/core/compiled";

export type TransProps = {
  // `id` is optional in authored source: components are written with `message`
  // and the Palamedes compiler transform injects the resolved id at build time.
  id?: string;
  message?: string;
  context?: string;
  comment?: string;
  values?: Record<string, unknown>;
  components?: Record<string, ReactElement>;
};

type RendererI18n = Pick<PalamedesI18n, "locale" | "timeZone" | "renderMessage">;
type ResettableReactMessageRuntime = {
  reset: (components: Record<string, ReactElement>) => void;
  runtime: CompiledMessageRuntime<ReactNode[]>;
};
type CachedReactMessageRuntime = ResettableReactMessageRuntime & {
  inUse: boolean;
  locale: string;
  timeZone: string | undefined;
};

const EMPTY_COMPONENTS: Record<string, ReactElement> = Object.freeze({});
const EMPTY_VALUES: Record<string, unknown> = Object.freeze({});

/** Creates the shared Trans component for package-root and compiled entries. */
export function createTrans(useI18n: () => RendererI18n) {
  const runtimeCache = createReactMessageRuntimeCache();
  return function Trans({
    id,
    message,
    values,
    components,
    context,
    comment,
  }: TransProps): ReactNode {
    const i18n = useI18n();
    const resolvedId = id ?? message ?? "";
    const metadata: MessageMetadata = {
      message,
      context,
      comment,
    };
    const lease = runtimeCache.acquire(i18n, components ?? EMPTY_COMPONENTS);
    try {
      return (
        <>{renderI18nMessage(i18n, resolvedId, values ?? EMPTY_VALUES, lease.runtime, metadata)}</>
      );
    } finally {
      runtimeCache.release(lease);
    }
  };
}

export function createReactMessageRuntimeCache() {
  // Cache one idle renderer per i18n instance. Nested synchronous renders get a
  // temporary renderer so they cannot overwrite an outer render's components
  // or keys. Weak keys keep request-scoped instances collectable.
  const cache = new WeakMap<RendererI18n, CachedReactMessageRuntime>();

  return {
    acquire(
      i18n: RendererI18n,
      components: Record<string, ReactElement>,
    ): CachedReactMessageRuntime {
      let cached = cache.get(i18n);
      if (
        cached === undefined ||
        cached.inUse ||
        cached.locale !== i18n.locale ||
        cached.timeZone !== i18n.timeZone
      ) {
        const canCache = cached?.inUse !== true;
        cached = {
          ...createResettableReactMessageRuntime(i18n, components),
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
    release(cached: CachedReactMessageRuntime): void {
      // Do not keep the last rendered React elements and their props alive.
      cached.reset(EMPTY_COMPONENTS);
      cached.inUse = false;
    },
  };
}

export function renderI18nMessage(
  i18n: RendererI18n,
  id: string,
  values: Record<string, unknown>,
  runtime: CompiledMessageRuntime<ReactNode[]>,
  metadata: MessageMetadata,
): ReactNode[] {
  return i18n.renderMessage(id, values, runtime, metadata);
}

export function createReactMessageRuntime(
  i18n: RendererI18n,
  components: Record<string, ReactElement>,
): CompiledMessageRuntime<ReactNode[]> {
  return createResettableReactMessageRuntime(i18n, components).runtime;
}

function createResettableReactMessageRuntime(
  i18n: RendererI18n,
  components: Record<string, ReactElement>,
): ResettableReactMessageRuntime {
  const locale = i18n.locale;
  const timeZone = i18n.timeZone;
  let currentComponents = components;
  let nextKey = 0;
  const runtime: CompiledMessageRuntime<ReactNode[]> = createCompiledMessageRuntime<ReactNode[]>(
    locale,
    {
      join(...parts) {
        const result: ReactNode[] = [];
        for (const part of parts) {
          if (typeof part === "string") {
            result.push(part);
          } else {
            for (let index = 0; index < part.length; index += 1) {
              if (index in part) result.push(part[index]);
            }
          }
        }
        return result;
      },
      value(value) {
        return [renderVariable(value, nextKey++)];
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
        if (component && isValidElement(component)) {
          return [cloneElement(component, { key: nextKey++ }, ...children)];
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

function renderVariable(value: unknown, key: number): ReactNode {
  if (isValidElement(value)) {
    return cloneElement(value, { key });
  }

  return stringifyValue(value);
}

export { Fragment };
