import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PACKAGE_BOUNDARY_STEP, QUICKSTART_STEPS, STACKS } from "./steps";

const readRepoFile = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const solidExample = JSON.parse(readRepoFile("../../../examples/solid-cookie/package.json")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

const solidPins = [
  `solid-js@${solidExample.dependencies["solid-js"]}`,
  `@solidjs/web@${solidExample.dependencies["@solidjs/web"]}`,
  `@solidjs/vite-plugin@${solidExample.devDependencies["@solidjs/vite-plugin"]}`,
];

describe("Solid quickstart pins", () => {
  it("pins the site install commands to the maintained Solid example versions", () => {
    const install = QUICKSTART_STEPS.solid[0];
    const commands = ("code" in install ? install.code : undefined) ?? "";

    for (const pin of solidPins) {
      expect(commands).toContain(pin);
    }
  });

  it("pins the first-run guide install commands to the maintained Solid example versions", () => {
    const guide = readRepoFile("../../../docs/first-working-translation.md");

    for (const pin of solidPins) {
      expect(guide).toContain(pin);
    }
  });
});

describe("quickstart step hierarchy", () => {
  it.each(STACKS)(
    "puts the package boundary directly after the $label install command",
    (stack) => {
      const steps = QUICKSTART_STEPS[stack.id];

      expect(steps[0]).toMatchObject({ title: "Install" });
      expect(steps[0]).toHaveProperty("code");
      expect(steps[1]).toBe(PACKAGE_BOUNDARY_STEP);
      expect(steps[2]).toMatchObject({ title: "Configure" });
      expect(steps).toHaveLength(7);
    },
  );
});
