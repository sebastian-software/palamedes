# Platform Support

Palamedes ships native packages for the CLI and the Node binding. Check this
page before installing `@palamedes/cli` or a package that uses
`@palamedes/core-node`.

<span id="nodejs-requirements"></span>

## Node.js Requirements

Palamedes v2 requires Node.js `>=24.3.0` for published Node.js packages and
repository development. Node.js 22 is no longer supported. CI validates Node.js
24 and 26. This table is the canonical list; the
[stability policy](./stability.md) explains the support contract.

| Node.js floor  | Applies to                                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `>=24.3.0`     | Every published Node.js package, including all framework adapters, `@palamedes/core`, `@palamedes/runtime`, `@palamedes/cli`, and the `@palamedes/core-node-*` addons |
| No declaration | The `@palamedes/cli-*` platform shells, which run native executables without Node.js                                                                                  |
| `>=24.3.0`     | This repository itself — development and CI, declared in the root `package.json` and shown by the repository Node badge                                               |

The shared floor includes the Remix v3 runtime requirement. `pnpm check:llms`
checks the published `engines.node` fields and this table against the shared
floor. The native CLI binaries can run directly without Node.js; the npm
`@palamedes/cli` launcher requires the shared Node.js floor.

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
