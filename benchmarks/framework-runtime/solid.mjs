import { createSignal, createComponent } from "solid-js";
import { render, insert } from "@solidjs/web";
import { createI18n } from "@palamedes/core/compiled";
import { setClientI18n } from "@palamedes/runtime";
import { Trans } from "@palamedes/solid/compiled";
import { messages } from "virtual:catalog";

const i18n = createI18n({ locale: "en" });
i18n.load("en", messages);
setClientI18n(i18n);
let dispose;
let update;
let host;
const components = {
  0(props) {
    const element = document.createElement("strong");
    insert(element, () => props.children);
    return element;
  },
};
globalThis.benchmark = {
  mount() {
    host = document.createElement("div");
    document.body.append(host);
    dispose = render(() => {
      const [tick, setTick] = createSignal(0);
      update = setTick;
      return Array.from({ length: 500 }, (_, index) =>
        createComponent(Trans, {
          id: "row",
          get values() {
            return { name: `Person ${index}`, count: (tick() % 5) + 1 };
          },
          components,
        }),
      );
    }, host);
  },
  update(tick) {
    update(tick);
  },
  probe() {
    return { text: host.textContent, tags: host.querySelectorAll("strong").length };
  },
  unmount() {
    dispose();
    host.remove();
    host = undefined;
    dispose = undefined;
    update = undefined;
  },
};
