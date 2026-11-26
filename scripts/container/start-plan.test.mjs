import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { EXAMPLE_MATRIX } from "../example-matrix.mjs";
import { buildPublishArgs } from "./port-plan.mjs";
import {
  CONTAINER_HOST,
  buildStartArgs,
  buildStartEnv,
  selectContainerExamples,
} from "./start-plan.mjs";

describe("buildStartArgs", () => {
  it("runs vite preview directly for tanstack with native config loading and a single host/port", () => {
    expect(buildStartArgs({ framework: "tanstack", start: ["preview"], port: 4020 })).toEqual([
      "exec",
      "vite",
      "preview",
      "--configLoader",
      "native",
      "--host",
      CONTAINER_HOST,
      "--port",
      "4020",
    ]);
  });

  it("runs Vite MDX directly with native config loading, a container-reachable host, and fixed port", () => {
    expect(buildStartArgs({ framework: "vite", start: ["preview"], port: 4070 })).toEqual([
      "exec",
      "vite",
      "preview",
      "--configLoader",
      "native",
      "--host",
      CONTAINER_HOST,
      "--port",
      "4070",
    ]);
  });

  it("runs the matrix start script unchanged for Next.js (binds 0.0.0.0 by default)", () => {
    expect(buildStartArgs({ framework: "nextjs", start: ["start"] })).toEqual(["start"]);
  });

  it("leaves the start script untouched for env-driven frameworks", () => {
    expect(buildStartArgs({ framework: "waku", start: ["start"] })).toEqual(["start"]);
    expect(buildStartArgs({ framework: "react-router", start: ["start"] })).toEqual(["start"]);
    expect(buildStartArgs({ framework: "solid", start: ["start"] })).toEqual(["start"]);
  });
});

describe("buildStartEnv", () => {
  it("forces HOST to the container host and pins the fixed port", () => {
    const env = buildStartEnv(
      { framework: "solid", port: 4050, startEnv: { HOST: "127.0.0.1", PORT: "4050" } },
      { EXISTING: "1" },
    );
    expect(env.HOST).toBe(CONTAINER_HOST);
    expect(env.PORT).toBe("4050");
    expect(env.EXISTING).toBe("1");
  });

  it("overrides a matrix startEnv that binds loopback", () => {
    const env = buildStartEnv({
      framework: "solid",
      port: 4051,
      startEnv: { HOST: "127.0.0.1" },
    });
    expect(env.HOST).toBe(CONTAINER_HOST);
  });
});

describe("container publish contract", () => {
  it("installs the pinned Rust toolchain before parallel workspace builds", async () => {
    const containerfile = await readFile(
      resolve(import.meta.dirname, "../../Containerfile"),
      "utf8",
    );
    const toolchainCopy = containerfile.indexOf("COPY rust-toolchain.toml ./");
    const toolchainInstall = containerfile.indexOf("RUN cargo --version");
    const workspaceCopy = containerfile.indexOf("COPY . .");
    const workspaceBuild = containerfile.indexOf("RUN pnpm build");

    expect(toolchainCopy).toBeGreaterThan(-1);
    expect(toolchainInstall).toBeGreaterThan(toolchainCopy);
    expect(workspaceCopy).toBeGreaterThan(toolchainInstall);
    expect(workspaceBuild).toBeGreaterThan(workspaceCopy);
  });

  it("publishes Vite MDX on its container-reachable start-plan port", async () => {
    const vite = EXAMPLE_MATRIX.find((example) => example.id === "vite-mdx");
    expect(vite).toBeDefined();
    expect(buildStartArgs(vite)).toEqual([
      "exec",
      "vite",
      "preview",
      "--configLoader",
      "native",
      "--host",
      CONTAINER_HOST,
      "--port",
      "4070",
    ]);
    expect(buildPublishArgs(EXAMPLE_MATRIX)).toContain("4070:4070");

    const containerfile = await readFile(
      resolve(import.meta.dirname, "../../Containerfile"),
      "utf8",
    );
    expect(containerfile).toMatch(/^EXPOSE .*\b4070\b/m);
  });

  it("hardens Containerfile base images, toolchain provisioning, runtime permissions, and health checks", async () => {
    const [containerfile, cargoToml, publishContainer, runExamplesDoc] = await Promise.all([
      readFile(resolve(import.meta.dirname, "../../Containerfile"), "utf8"),
      readFile(resolve(import.meta.dirname, "../../Cargo.toml"), "utf8"),
      readFile(
        resolve(import.meta.dirname, "../../.github/workflows/publish-examples-container.yml"),
        "utf8",
      ),
      readFile(
        resolve(import.meta.dirname, "../../docs/operations/run-examples-container.md"),
        "utf8",
      ),
    ]);

    const rustVersion = cargoToml.match(/^rust-version\s*=\s*"([^"]+)"/mu)?.[1];
    expect(rustVersion).toBeTruthy();

    const nonCommentLines = containerfile
      .split(/\r?\n/u)
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");

    expect(nonCommentLines).not.toContain("sh.rustup.rs");
    expect(nonCommentLines).not.toContain("npm install -g");
    expect(nonCommentLines).not.toContain("/usr/local/rustup");
    expect(containerfile).toMatch(
      new RegExp(
        `^FROM rust:${rustVersion.replaceAll(".", "\\.")}-bookworm@sha256:[0-9a-f]{64} AS rust-toolchain$`,
        "mu",
      ),
    );
    expect(containerfile).toMatch(/^FROM node:24-bookworm@sha256:[0-9a-f]{64} AS build$/mu);
    expect(containerfile).toMatch(/^FROM node:24-bookworm-slim@sha256:[0-9a-f]{64} AS runtime$/mu);
    expect(containerfile).toContain("COPY --from=rust-toolchain /usr/local/rust /usr/local/rust");
    expect(containerfile).toContain("pnpm_config_verify_deps_before_run=false");
    expect(containerfile).toContain("-exec chmod a+rX,go-w");
    expect(containerfile).toContain("-perm /022");
    expect(containerfile).toContain("COPY --from=build --chown=root:root /app /app");
    expect(containerfile).not.toContain("--chown=node:node");
    expect(containerfile).toContain("USER node");
    expect(containerfile).toMatch(/^HEALTHCHECK\b.*127\.0\.0\.1:4080\/ready/msu);
    expect(containerfile).toContain("podman build --format docker -f Containerfile");
    expect(runExamplesDoc).toContain("podman build --format docker -f Containerfile");
    expect(publishContainer).toContain('test "$(docker exec examples-smoke id -un)" = node');
    expect(publishContainer).toContain("if docker exec examples-smoke sh -c 'touch /app/.ro-check");
    expect(publishContainer).toContain("docker exec examples-smoke sh -eu -c '");
    expect(publishContainer).toContain(
      "writable=$(find /app /usr/local/share/corepack ! -type l \\( -perm /022 -o -writable \\)",
    );

    for (const dir of ["crates", "docs", "adr", "tests", "benchmarks", "fuzz", "site", "video"]) {
      expect(containerfile).toMatch(new RegExp(`\\b${dir}\\b`, "u"));
    }

    for (const strategy of ["cookie", "route", "subdomain", "tld"]) {
      await expect(
        access(resolve(import.meta.dirname, `../../examples/react-router-${strategy}/Dockerfile`)),
      ).rejects.toThrow();
    }
  });
});

describe("container example selection", () => {
  it("retains all examples when no deployment selection is configured", () => {
    expect(selectContainerExamples(EXAMPLE_MATRIX)).toBe(EXAMPLE_MATRIX);
  });

  it("runs exactly the four Remix strategies in the low-traffic deployment", () => {
    const selection = "remix-cookie,remix-route,remix-subdomain,remix-tld";
    const examples = selectContainerExamples(EXAMPLE_MATRIX, selection);
    expect(examples.map((example) => example.id)).toEqual(selection.split(","));
    expect(examples.map((example) => example.port)).toEqual([4060, 4061, 4062, 4063]);
  });

  it("rejects empty, unknown, and duplicated IDs before starting any server", () => {
    for (const selection of [
      "",
      " ",
      "remix-cookie,",
      "remix",
      "remix-cookie,unknown",
      "remix-cookie,remix-cookie",
    ]) {
      expect(() => selectContainerExamples(EXAMPLE_MATRIX, selection)).toThrow(
        "PALAMEDES_EXAMPLES",
      );
    }
  });

  it("accepts surrounding whitespace and retains matrix port assignments", () => {
    expect(
      selectContainerExamples(EXAMPLE_MATRIX, " remix-tld , remix-cookie ").map(
        (example) => example.port,
      ),
    ).toEqual([4060, 4063]);
  });
});
