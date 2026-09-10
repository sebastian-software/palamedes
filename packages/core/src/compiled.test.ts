import { describe, expect, it, vi } from "vitest";

import {
  createI18n,
  defineCompiledCatalog,
  type CompiledCatalogMessages,
  type CompiledMessage,
  type CompiledMessageBranch,
} from "./compiled";

describe("parser-free compiled runtime", () => {
  it("refreshes the string renderer across locale round trips without changing its time zone", () => {
    const message: CompiledMessage = (args, runtime) =>
      runtime.join(runtime.number(args, "amount"), " / ", runtime.date(args, "date", "short"));
    const i18n = createI18n({ locale: "en-US", timeZone: "America/Los_Angeles" });
    const catalog = defineCompiledCatalog({ message });
    i18n.load("en-US", catalog);
    i18n.load("de-DE", catalog);
    const values = { amount: 1234.5, date: new Date("2026-09-10T01:00:00Z") };
    for (const locale of ["en-US", "de-DE", "en-US", "de-DE"]) {
      i18n.activate(locale);
      expect(i18n._("message", values)).toBe(
        `${new Intl.NumberFormat(locale).format(values.amount)} / ${new Intl.DateTimeFormat(
          locale,
          {
            timeZone: "America/Los_Angeles",
            dateStyle: "short",
          },
        ).format(values.date)}`,
      );
    }
  });

  it("keeps an outer renderer usable when a value getter performs a nested lookup in another locale", () => {
    const message: CompiledMessage = (values, runtime) =>
      runtime.join(runtime.value(values, "nested"), " / ", runtime.number(values, "amount"));
    const amount: CompiledMessage = (values, runtime) => runtime.number(values, "amount");
    const i18n = createI18n({ locale: "en-US" });
    i18n.load("en-US", defineCompiledCatalog({ message, amount }));
    i18n.load("de-DE", defineCompiledCatalog({ amount }));
    expect(
      i18n._("message", {
        amount: 1234.5,
        get nested() {
          i18n.activate("de-DE");
          const result = i18n._("amount", { amount: 1234.5 });
          i18n.activate("en-US");
          return result;
        },
      }),
    ).toBe("1.234,5 / 1,234.5");
    expect(i18n._("amount", { amount: 1234.5 })).toBe("1,234.5");
  });

  it("renders generated constants, variables, and plurals without parsing ICU", () => {
    const greeting: CompiledMessage = (values, runtime) =>
      runtime.join("Hallo ", runtime.value(values, "name"));
    const one: CompiledMessageBranch = (_values, runtime) => runtime.join("eine Nachricht");
    const other: CompiledMessageBranch = (_values, runtime, pluralValue) =>
      runtime.join(runtime.pound(pluralValue!), " Nachrichten");
    const inbox: CompiledMessage = (values, runtime) =>
      runtime.plural(values, "count", 0, "plural", { one, other });

    const i18n = createI18n({ locale: "de" });
    i18n.load(
      "de",
      defineCompiledCatalog({
        plain: "Willkommen",
        greeting,
        inbox,
      }),
    );

    expect(i18n._("plain")).toBe("Willkommen");
    expect(i18n._("greeting", { name: "Ada" })).toBe("Hallo Ada");
    expect(i18n._("inbox", { count: 2 })).toBe("2 Nachrichten");
  });

  it("preserves date-only ISO strings as civil dates in compiled messages", () => {
    const due: CompiledMessage = (values, runtime) =>
      runtime.join("Due ", runtime.date(values, "when", "medium"));
    const losAngeles = createI18n({ locale: "en-US", timeZone: "America/Los_Angeles" });
    const tokyo = createI18n({ locale: "en-US", timeZone: "Asia/Tokyo" });

    losAngeles.load("en-US", defineCompiledCatalog({ due }));
    tokyo.load("en-US", defineCompiledCatalog({ due }));

    expect(losAngeles._("due", { when: "2026-06-12" })).toBe("Due Jun 12, 2026");
    expect(tokyo._("due", { when: "2026-06-12" })).toBe("Due Jun 12, 2026");
  });

  it("rejects hand-written string catalogs at the load boundary", () => {
    const i18n = createI18n();

    expect(i18n.parsePattern).toBeUndefined();
    expect(() =>
      i18n.load("de", { greeting: "Hallo {name}" } as unknown as CompiledCatalogMessages),
    ).toThrow(/only accepts generated CompiledCatalogMessages/);
  });

  it("reports lazy-pattern calls and degrades to the source fallback", () => {
    const onError = vi.fn();
    const lazy: CompiledMessage = (values, runtime) => runtime.pattern("Hallo {name}", values);
    const i18n = createI18n({ locale: "de", onError });
    i18n.load("de", defineCompiledCatalog({ lazy }));

    expect(i18n._("lazy", { name: "Ada" }, { message: "Hello {name}" })).toBe("Hello {name}");
    expect(onError).toHaveBeenCalledOnce();
  });

  it("does not parse unresolved fallbacks with the parser-free string renderer", () => {
    const onError = vi.fn();
    const i18n = createI18n({ onError });

    expect(i18n._("missing", { name: "Ada" }, { message: "Hello {name}" })).toBe("Hello {name}");
    expect(i18n._("missing", { name: "Ada" })).toBe("missing");
    expect(onError).not.toHaveBeenCalled();
  });
});
