# Security Policy

Palamedes is a build-time and runtime infrastructure for JavaScript applications.
Please report security issues privately so maintainers can assess and fix them
before public disclosure.

## Supported Versions

Palamedes ships publishable packages in lockstep. Security fixes target the
latest released 1.x version line.

| Version    | Supported   |
| ---------- | ----------- |
| Latest 1.x | Yes         |
| Older 1.x  | Best effort |
| 0.x        | No          |

## Reporting A Vulnerability

Use GitHub private vulnerability reporting when it is available for this
repository. If that is not available, email:

```text
security@sebastian-software.de
```

Please include:

- affected package and version
- environment details
- reproduction steps or proof of concept
- expected impact
- whether the issue is already public

Do not open a public GitHub issue for a vulnerability.

## Scope

Security-relevant areas include:

- macro transformation and generated runtime code
- `.po` catalog parsing and compilation
- native binding loading
- CLI commands that read or write project files
- GitHub Actions release and publish automation

## Disclosure

Maintainers will acknowledge reports as soon as practical, investigate the
impact, and coordinate a fix and release. Public disclosure should wait until a
patched version is available unless there is an active public exploit.
