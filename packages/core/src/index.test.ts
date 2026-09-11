import { describe, expect, it, vi } from "vitest";

import * as root from "./index";
import * as compiled from "./compiled";
import { createStringMessageRuntime } from "./compiledMessage";

const greeting: root.CompiledMessage = (values, runtime) =>
  runtime.join("Hello ", runtime.value(values, "name"));
const number: root.CompiledMessage = (values, runtime) => runtime.number(values, "amount");
const date: root.CompiledMessage = (values, runtime) => runtime.date(values, "when", "medium");

describe("unified public compiled runtime", () => {
  it("uses one implementation through both public entrypoints and omits parser APIs", () => {
    expect(root.createI18n).toBe(compiled.createI18n);
    expect(root.createI18n().locale).toBe("en");
    for (const entry of [root, compiled]) {
      for (const removed of [
        "parseMessagePattern",
        "formatMessagePattern",
        "buildChoiceMessage",
        "resolveChoice",
      ]) {
        expect(entry).not.toHaveProperty(removed);
      }
    }
    for (const removed of ["parsePattern", "getMessageNodes", "getMessage", "reportError"]) {
      expect(root.createI18n()).not.toHaveProperty(removed);
    }
  });

  it("executes constants and functions, including compiled source-language fallbacks", () => {
    const i18n = root.createI18n({ locale: "de" });
    i18n.load("de", root.defineCompiledCatalog({ greeting, constant: "Hallo", empty: "" }));
    expect(i18n._("greeting", { name: "Ada" })).toBe("Hello Ada");
    expect(i18n._("constant")).toBe("Hallo");
    expect(i18n._("empty")).toBe("");
  });

  it.each([undefined, "Fallback {name}", "private-internal-key"])(
    "throws on a missing catalog or entry regardless of source metadata %s",
    (message) => {
      const onMissing = vi.fn();
      const i18n = root.createI18n({ locale: "de", onMissing });
      const lookup = () => i18n._("private-internal-key", { name: "Ada" }, { message });
      expect(lookup).toThrow(root.MissingCompiledMessageError);
      i18n.load("de", root.defineCompiledCatalog({ present: "Present" }));
      expect(lookup).toThrow(root.MissingCompiledMessageError);
      expect(onMissing).toHaveBeenCalledWith({
        id: "private-internal-key",
        locale: "de",
        metadata: { message },
      });
      try {
        lookup();
      } catch (error) {
        expect(error).toMatchObject({ id: "private-internal-key", locale: "de" });
        expect((error as Error).message).not.toContain("private-internal-key");
        expect((error as Error).message).not.toContain("Fallback");
      }
    },
  );

  it("cannot recover a missing dependency through telemetry, even when the observer loads a catalog", () => {
    const i18n = root.createI18n({
      onMissing() {
        i18n.load("en", root.defineCompiledCatalog({ greeting }));
      },
    });
    expect(() => i18n._("greeting", { name: "Ada" })).toThrow(root.MissingCompiledMessageError);
    expect(i18n._("greeting", { name: "Ada" })).toBe("Hello Ada");
    const noisy = root.createI18n({
      onMissing() {
        throw new Error("telemetry failed");
      },
    });
    expect(() => noisy._("private")).toThrow(root.MissingCompiledMessageError);
  });

  it("propagates execution failures once through onError without substituting source patterns", () => {
    const failure = new Error("formatter failed");
    const onError = vi.fn(() => {
      throw new Error("observer failed");
    });
    const i18n = root.createI18n({ locale: "de", onError });
    i18n.load(
      "de",
      root.defineCompiledCatalog({
        broken() {
          throw failure;
        },
      }),
    );
    expect(() => i18n._("broken", {}, { message: "Source {value}" })).toThrow(failure);
    expect(onError).toHaveBeenCalledExactlyOnceWith({
      id: "broken",
      locale: "de",
      error: failure,
      metadata: { message: "Source {value}" },
    });
    const runtime = createStringMessageRuntime("de");
    expect(() => i18n.renderMessage("broken", {}, runtime)).toThrow(failure);
  });

  it("propagates invalid formatter inputs and missing values", () => {
    const i18n = root.createI18n();
    i18n.load("en", root.defineCompiledCatalog({ greeting, number, date }));
    expect(() => i18n._("greeting")).toThrow(/Missing compiled message value/);
    for (const amount of [null, undefined, "wrong", Number.NaN, Infinity]) {
      expect(() => i18n._("number", { amount })).toThrow(/finite numeric/);
    }
    for (const when of [null, "wrong", new Date(Number.NaN)]) {
      expect(() => i18n._("date", { when })).toThrow(/valid date/);
    }
  });

  it("rejects uncompiled and malformed branded catalogs atomically", () => {
    const i18n = root.createI18n();
    i18n.load("en", root.defineCompiledCatalog({ greeting }));
    expect(() =>
      i18n.load("en", { greeting: "Raw {name}" } as unknown as root.CompiledCatalogMessages),
    ).toThrow(/Compile ICU catalogs/);
    expect(() =>
      root.defineCompiledCatalog({
        greeting: "Wrong",
        broken: 42 as unknown as string,
      }),
    ).toThrow(/Invalid compiled catalog entry/);
    expect(i18n._("greeting", { name: "Ada" })).toBe("Hello Ada");
  });

  it("isolates locale and time zone and preserves civil dates", () => {
    const catalogs = root.defineCompiledCatalog({ date, number });
    const la = root.createI18n({ locale: "en-US", timeZone: "America/Los_Angeles" });
    const tokyo = root.createI18n({ locale: "de-DE", timeZone: "Asia/Tokyo" });
    la.load("en-US", catalogs);
    tokyo.load("de-DE", catalogs);
    expect(la._("date", { when: "2026-06-12" })).toBe("Jun 12, 2026");
    expect(tokyo._("date", { when: "2026-06-12" })).toBe("12.06.2026");
    expect(la._("number", { amount: 1234.5 })).toBe("1,234.5");
    expect(tokyo._("number", { amount: 1234.5 })).toBe("1.234,5");
    expect(() => root.createI18n({ timeZone: "invalid-zone" })).toThrow(/Invalid IANA/);
    expect(() => root.createI18n({ timeZone: "" })).toThrow(/non-empty IANA/);
  });
});
