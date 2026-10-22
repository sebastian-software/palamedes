import { execFileSync } from "node:child_process";
import { COMPONENT_FRAMEWORKS } from "./component-demos.mjs";

// Build each shared application once; its four servers resolve locale per request.
for (const demo of COMPONENT_FRAMEWORKS) {
  execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: demo.cwd, stdio: "inherit" });
  execFileSync("pnpm", ["build"], { cwd: demo.cwd, stdio: "inherit" });
}
