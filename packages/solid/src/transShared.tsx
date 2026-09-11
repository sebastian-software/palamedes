import { createComponent, createMemo, type Element, type FlowComponent } from "solid-js";

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

type RichTextComponent = FlowComponent<{}, Element>;

export type TransProps = {
  // `id` is optional in authored source: components are written with `message`
  // and the Palamedes compiler transform injects the resolved id at build time.
  id?: string;
  message?: string;
  context?: string;
  comment?: string;
  values?: Record<string, unknown>;
  components?: Record<string, RichTextComponent>;
};

type RendererI18n = Pick<PalamedesI18n, "locale" | "timeZone" | "renderMessage">;

/** Creates the shared Trans component for package-root and compiled entries. */
export function createTrans(getI18n: () => RendererI18n) {
  return function Trans(props: TransProps): Element {
    const content = createMemo(() => {
      const i18n = getI18n();
      const resolvedId = props.id ?? props.message ?? "";
      const metadata: MessageMetadata = {
        message: props.message,
        context: props.context,
        comment: props.comment,
      };
      const runtime = createSolidMessageRuntime(i18n, props.components ?? {});
      return renderI18nMessage(i18n, resolvedId, props.values ?? {}, runtime, metadata);
    });

    // Solid resolves accessor children reactively. Its Element type does not
    // currently include the accessor shape returned by createMemo.
    return content as unknown as Element;
  };
}

export function renderI18nMessage(
  i18n: RendererI18n,
  id: string,
  values: Record<string, unknown>,
  runtime: CompiledMessageRuntime<Element[]>,
  metadata: MessageMetadata,
): Element[] {
  return i18n.renderMessage(id, values, runtime, metadata);
}

export function createSolidMessageRuntime(
  i18n: RendererI18n,
  components: Record<string, RichTextComponent>,
): CompiledMessageRuntime<Element[]> {
  const locale = i18n.locale;
  const timeZone = i18n.timeZone;
  const runtime: CompiledMessageRuntime<Element[]> = createCompiledMessageRuntime<Element[]>(
    locale,
    {
      join(...parts: Array<string | Element[]>) {
        const result: Element[] = [];
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
      value(value: unknown) {
        return [renderVariable(value)];
      },
      number(value: unknown, style?: string) {
        return [formatMessageArgument("number", value, style, locale)];
      },
      date(value: unknown, style?: string) {
        return [formatMessageArgument("date", value, style, locale, timeZone)];
      },
      time(value: unknown, style?: string) {
        return [formatMessageArgument("time", value, style, locale, timeZone)];
      },
      pound(value: number) {
        return [replacePoundPlaceholders("#", value, locale)];
      },
      literal(value: string) {
        return [value];
      },
      tag(name: string, children: Element[]) {
        const component = components[name];
        if (component !== undefined) {
          return [
            createComponent(component, {
              get children() {
                return children;
              },
            }),
          ];
        }
        return children;
      },
    },
  );
  return runtime;
}

function renderVariable(value: unknown): Element {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return stringifyValue(value);
  }
  return value as Element;
}
