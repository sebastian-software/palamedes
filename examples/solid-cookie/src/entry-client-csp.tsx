import { hydrate } from "@solidjs/web";
import { createComponent } from "solid-js";
import App from "./App";
import Document from "./Document";

hydrate(() => <Document>{createComponent(App, {})}</Document>, document);
