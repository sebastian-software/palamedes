export type { RuntimeMacroManifest } from "./node-macros";

export function registerRuntimeMacros(_manifest: unknown): void {
  throw new Error(
    "@palamedes/runtime/node-macros is only available in Node.js. Bundled code compiles macros with a Palamedes plugin instead.",
  );
}
