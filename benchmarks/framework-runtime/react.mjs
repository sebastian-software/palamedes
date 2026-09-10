import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createI18n } from "@palamedes/core/compiled";
import { setClientI18n } from "@palamedes/runtime";
import { Trans } from "@palamedes/react/compiled";
import { messages } from "virtual:catalog";

const i18n = createI18n({ locale: "en" });
i18n.load("en", messages);
setClientI18n(i18n);
let root;
let host;
let lastComponent;
function rows(tick) {
  return Array.from({ length: 500 }, (_, index) => {
    const component = createElement("strong");
    if (index === 499) lastComponent = new WeakRef(component);
    return createElement(Trans, {
      key: index,
      id: "row",
      values: { name: `Person ${index}`, count: (tick % 5) + 1 },
      components: { 0: component },
    });
  });
}
globalThis.benchmark = {
  retainedComponent() {
    return lastComponent?.deref() !== undefined;
  },
  mount() {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    flushSync(() => root.render(rows(0)));
  },
  update(tick) {
    flushSync(() => root.render(rows(tick)));
  },
  probe() {
    return { text: host.textContent, tags: host.querySelectorAll("strong").length };
  },
  unmount() {
    flushSync(() => root.unmount());
    host.remove();
    host = undefined;
    root = undefined;
  },
};
