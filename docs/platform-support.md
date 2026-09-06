# Platform Support

Palamedes ships native packages for the CLI and the Node binding. Check this
page before installing `@palamedes/cli` or a package that uses
`@palamedes/core-node`.

## Node.js Requirements

Published packages declare their own Node.js floor, so there is no single
number for the whole project. This table is the canonical list; the
[stability policy](./stability.md) explains what those floors mean for support.

| Node.js floor  | Applies to                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `>=22.0.0`     | Every published package except the rows below, including `@palamedes/core`, `@palamedes/runtime`, `@palamedes/cli`, and the `@palamedes/core-node-*` addons |
| `>=22.22.0`    | `@palamedes/react-router-rsc`, `@palamedes/tanstack`, `@palamedes/waku`                                                                                     |
| `>=24.3.0`     | `@palamedes/remix`, whose floor follows the supported full-stack Remix v3 runtime                                                                           |
| No declaration | The `@palamedes/cli-*` platform shells, which leave Node compatibility to their `@palamedes/cli` wrapper                                                    |
| `>=22.22.0`    | This repository itself — development and CI, declared in the root `package.json` and shown by the repository Node badge                                     |

The repository floor is stricter than every published package on purpose:
contributors run the full workspace, not one integration. `pnpm check:llms`
compares this table with the `engines.node` field of every published package,
so a package that changes its floor fails the check until the table is updated.

## Supported Targets

These are the six targets published for both native package families. The npm
wrapper selects the matching optional dependency from the Node process platform,
architecture, and, on Linux, C library.

| Node OS  | Host    | Node architecture | Linux C library | CLI package                       | Node binding package                    |
| -------- | ------- | ----------------- | --------------- | --------------------------------- | --------------------------------------- |
| `darwin` | macOS   | arm64             | Not applicable  | `@palamedes/cli-darwin-arm64`     | `@palamedes/core-node-darwin-arm64`     |
| `linux`  | Linux   | x64               | glibc           | `@palamedes/cli-linux-x64-gnu`    | `@palamedes/core-node-linux-x64-gnu`    |
| `linux`  | Linux   | x64               | musl            | `@palamedes/cli-linux-x64-musl`   | `@palamedes/core-node-linux-x64-musl`   |
| `linux`  | Linux   | arm64             | glibc           | `@palamedes/cli-linux-arm64-gnu`  | `@palamedes/core-node-linux-arm64-gnu`  |
| `linux`  | Linux   | arm64             | musl            | `@palamedes/cli-linux-arm64-musl` | `@palamedes/core-node-linux-arm64-musl` |
| `win32`  | Windows | x64               | Not applicable  | `@palamedes/cli-win32-x64-msvc`   | `@palamedes/core-node-win32-x64-msvc`   |

`glibc` is the GNU C library used by many Linux distributions. Alpine Linux
and other musl-based distributions must use the matching musl row. Keep npm
optional dependencies enabled so the wrapper can install and select that
package.

## Unsupported Node Processes

There is no published package for `darwin/x64`: Intel macOS is unsupported.
This also applies when an Apple Silicon Mac runs an x64 Node process under
Rosetta, because the resolver sees `darwin/x64`, not the hardware architecture.

There is no published package for `win32/arm64`: Windows on ARM is unsupported
when its Node process reports that target.

Check the Node process target before installation or in a failing environment:

```bash
node -p '`${process.platform}/${process.arch}`'
```

Use a host and Node process that match a row in the table. For example, on an
Apple Silicon Mac use an arm64 Node installation rather than an x64 Node process
under Rosetta. For a native binding failure caused by an optional dependency
being pruned, follow the recovery steps in the
[troubleshooting guide](./troubleshooting.md#native-binding-fails-to-load).

The platform packages are internal dependency carriers. Install
`@palamedes/cli` or the app-facing integration package in normal projects;
install a listed platform package directly only when the target is known in
advance, such as a CI image.
