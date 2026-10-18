import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { createIntegration } from "./integration.mjs";

registerHooks(createIntegration(fileURLToPath(new URL("../", import.meta.url))).createHooks());
