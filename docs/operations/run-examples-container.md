# Alle Examples gemeinsam im Container betreiben

Dieses Dokument beschreibt, wie alle zehn Palamedes-Example-Apps gemeinsam in
**einem** Podman-Container laufen – jede auf ihrem festen Port. Grundlage sind das
`Containerfile` im Repo-Root und der Supervisor `scripts/container/start-all.mjs`.

> Ein Reverse-Proxy, der jeden Port auf eine eigene Domain mappt, ist bewusst
> **nicht** Teil dieses Setups. Die festen Ports existieren genau dafür, dass ein
> solcher Proxy später davor gesetzt werden kann (siehe „Ausblick").

## Voraussetzungen

- [Podman](https://podman.io/) installiert
- Ausreichend Ressourcen für zehn gleichzeitige SSR-Node-Server (mehrere GB RAM
  empfohlen)

Ein Rust- oder Node-Setup auf dem Host ist **nicht** nötig: Der Build-Stage des
Containers bringt Node, pnpm und die Rust-Toolchain selbst mit und baut das native
`@palamedes/core-node`-Addon sowie alle Examples im Image.

## Image bauen

```bash
podman build -f Containerfile -t palamedes-examples .
```

Der Build ist mehrstufig:

1. **Build-Stage** (glibc/Debian): `pnpm install`, `pnpm build` (baut die Packages
   inkl. nativem Addon via `cargo` im Release-Profil) und `pnpm build:examples`
   (baut alle zehn Apps). Die `cargo`-Kompilierung verlängert den ersten Build
   spürbar.
2. **Runtime-Stage** (schlankeres Debian-Slim): übernimmt das fertige Workspace
   und startet den Supervisor. Die Dev-Dependencies bleiben installiert, weil
   TanStacks `vite preview` und SolidStarts `vinxi start` daraus stammen.

## Container starten

Die zu veröffentlichenden Ports werden aus der Matrix generiert, damit der
Startbefehl nicht von den tatsächlich gebundenen Ports abdriftet:

```bash
podman run --init $(node ./scripts/container/print-podman-ports.mjs) palamedes-examples
```

Ausgeschrieben entspricht das `-p 4010:4010 -p 4011:4011 … -p 4051:4051`.

- `--init` sorgt dafür, dass reparentete Kindprozesse sauber eingesammelt werden.
  Das Image bringt zusätzlich `tini` als Entrypoint mit, sodass das Reaping auch
  ohne `--init` funktioniert (z. B. später via Compose/Quadlet).
- **Restart-Verhalten:** Der Supervisor arbeitet fail-fast – stirbt ein Server,
  endet der Container mit Fehlercode. Für einen dauerhaften Demo-Betrieb daher
  ohne `--rm` starten und `--restart=on-failure` ergänzen; für einen einmaligen
  Vordergrund-Lauf `--rm` verwenden und den Abbruch bewusst in Kauf nehmen.

Der Supervisor startet alle Apps aus `scripts/example-matrix.mjs`, präfixt deren
Ausgabe mit der Example-ID (`[nextjs-cookie] …`) und beendet den Container
absichtlich mit Fehlercode, sobald ein Server unerwartet stirbt (fail-fast).
`podman stop` beendet alle zehn Server über weitergeleitetes `SIGTERM`.

## Port-Übersicht

| Port | Example | Strategie |
| ---- | ------------------------ | ------ |
| 4010 | `nextjs-cookie` | cookie |
| 4011 | `nextjs-route` | route |
| 4020 | `tanstack-cookie` | cookie |
| 4021 | `tanstack-route` | route |
| 4030 | `waku-cookie` | cookie |
| 4031 | `waku-route` | route |
| 4040 | `react-router-cookie` | cookie |
| 4041 | `react-router-route` | route |
| 4050 | `solidstart-cookie` | cookie |
| 4051 | `solidstart-route` | route |

`scripts/example-matrix.mjs` ist die einzige Quelle der Wahrheit für die Ports.
Der Supervisor bindet automatisch danach, und der oben gezeigte
`print-podman-ports.mjs`-Aufruf generiert die `-p`-Flags ebenfalls daraus – beide
ziehen also ohne manuellen Eingriff nach. Nur die statische `EXPOSE`-Zeile im
`Containerfile` ist rein informativ und muss bei einer Portänderung von Hand
nachgezogen werden.

## Host-Binding

Alle Server lauschen im Container auf `0.0.0.0`, damit ein externer Reverse-Proxy
die veröffentlichten Ports erreicht. Zwei Frameworks binden lokal sonst nur an
`127.0.0.1`; der Supervisor überschreibt das container-spezifisch, ohne die
Beispiel-`package.json` zu ändern:

- **SolidStart** (`vinxi`): `HOST=0.0.0.0` per Umgebungsvariable
- **TanStack** (`vite preview`): zusätzliches `--host 0.0.0.0` auf der Kommandozeile

Next.js und React Router binden bereits `0.0.0.0` bzw. respektieren `HOST`. Waku
wird über `HOST=0.0.0.0` gesteuert; bestätige beim ersten Container-Lauf die
externe Erreichbarkeit von `4030`/`4031`, falls `waku start` `HOST` nicht
respektiert.

## Prüfen

Nach dem Start liefert jeder Port eine Antwort (Cookie-Strategie auf `/`,
Route-Strategie auf `/en`):

```bash
curl -sf http://127.0.0.1:4010/ >/dev/null && echo "nextjs-cookie ok"
curl -sf http://127.0.0.1:4011/en >/dev/null && echo "nextjs-route ok"
# … analog für die übrigen Ports
```

## Ausblick (nicht Teil dieses Setups)

- Ein externer Reverse-Proxy (z. B. Caddy, Traefik oder nginx) mappt jeden Port
  auf eine eigene Domain und terminiert TLS.
- Optionaler Betrieb als systemd-Dienst über eine Podman-Quadlet-`.container`-Unit.
