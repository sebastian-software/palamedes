# 0001: Alle Examples gemeinsam in einem Container

**Plan status:** Implemented
**Quelle:** /plan
**Empfohlener Workflow:** Feature (`/build`)

## Anforderung

Alle zehn Example-Apps der Palamedes-Matrix sollen gemeinsam in **einem einzigen
Container** (gebaut und betrieben mit Podman) nebeneinander laufen – jede auf
ihrem festen, bereits definierten Port. Ziel ist ein Betrieb als Produktions-Build
(`build` + `start`), nicht als Dev-Server.

Die Ports sind bewusst fix, damit später ein **externer Reverse-Proxy** jede App
auf eine eigene Domain mappen kann. Dieser Reverse-Proxy und das Domain-Mapping
sind **ausdrücklich nicht Teil dieses Plans**, sondern nur als Ziel/Ausblick
festgehalten (siehe „Ziel/Ausblick").

Begründung der Workflow-Empfehlung: Es entsteht neue Funktionalität (containerisierter
Multi-App-Runtime) mit neuen Artefakten (`Containerfile`, Supervisor-Skript,
Build-Context-Ignore). Das ist ein **Feature** und wird über `/build` umgesetzt.

## Architekturentscheidungen

- **Single-Container-Ansatz, kein Pod/Compose.** Alle zehn Server laufen als
  Kindprozesse in einem Container. Ein schlankes Node-Supervisor-Skript startet
  und überwacht sie. (Verifizierter Kontext: die Apps sind reine Node-SSR-Server
  mit je eigenem Port.)
- **Fixe Ports aus der bestehenden Single Source of Truth.** Ports, IDs und
  Start-Skripte stammen weiterhin aus `scripts/example-matrix.mjs`
  (`EXAMPLE_MATRIX`). Der Supervisor importiert diese Liste, statt Ports zu
  duplizieren. Portlayout: `4010` nextjs-cookie, `4011` nextjs-route,
  `4020` tanstack-cookie, `4021` tanstack-route, `4030` waku-cookie,
  `4031` waku-route, `4040` react-router-cookie, `4041` react-router-route,
  `4050` solidstart-cookie, `4051` solidstart-route.
- **Produktions-Serving.** Das Image baut alle Packages und Examples zur
  Build-Zeit (`pnpm build` + `pnpm build:examples`). Der Supervisor führt zur
  Laufzeit nur noch die `start`- bzw. `preview`-Skripte aus (kein Build zur
  Laufzeit). Die Start-Skripte je Framework entsprechen der Matrix: Next.js/Waku/
  React Router = `start`, TanStack = `preview`, SolidStart = `start` mit
  `PORT`-Env.
- **glibc-Basis (Debian), nicht Alpine.** Das native N-API-Modul wird per
  `cargo build --package palamedes-node` gebaut und vom Build-Skript in
  `packages/core-node-linux-x64-gnu/palamedes-node.node` abgelegt (verifiziert in
  `packages/core-node/scripts/build-native.mjs`). Auf einer glibc-Basis baut das
  Ziel-Paket `@palamedes/core-node-linux-x64-gnu` ohne Cross-Compile. Alpine/musl
  würde `x86_64-unknown-linux-musl` + `PALAMEDES_ALLOW_CROSS_NATIVE=1` erfordern
  und ist damit unnötig komplexer. Der Build-Stage braucht deshalb **Node ≥ 22.22
  + pnpm 11.1.3 + Rust-Toolchain (stable ≥ 1.93)**.
- **Release-Profil für das native Modul.** Im Build-Stage wird
  `PALAMEDES_RUST_PROFILE=release` gesetzt, damit eine Release-Binary statt des
  Default-Debug-Builds entsteht.
- **Host-Binding auf `0.0.0.0` zentral im Supervisor, keine Beispiel-Edits.**
  Damit ein externer Reverse-Proxy die veröffentlichten Container-Ports erreicht,
  müssen alle Server auf `0.0.0.0` lauschen. Zwei Examples binden lokal an
  `127.0.0.1` (SolidStart via `startEnv.HOST` in der Matrix, TanStack via
  `preview --host 127.0.0.1` im Skript). Der Supervisor überschreibt das
  container-spezifisch (SolidStart: `HOST=0.0.0.0`; TanStack: zusätzliches
  `--host 0.0.0.0` anhängen, das bei Vite die letzte Angabe gewinnen lässt). Die
  Beispiel-`package.json` bleiben unverändert; die Override-Logik ist ein
  container-spezifisches Detail und bläht die Matrix nicht auf.
- **Multi-Stage-Build.** Ein Build-Stage mit Rust-Toolchain erzeugt die native
  Binary und alle Build-Outputs; ein schlankerer Runtime-Stage (`node:*-slim`)
  übernimmt das fertige Workspace (`/app` inkl. `node_modules`, gebauter
  `packages/*` und Example-Outputs) und startet den Supervisor. Die Rust-Toolchain
  bleibt außerhalb des Laufzeit-Images.
- **Build-Context-Hygiene.** Eine `.containerignore` schließt insbesondere
  `node_modules/`, `target/` und `**/*.node` des Hosts aus, damit keine
  fremde (z. B. macOS-arm64-) Native-Binary oder Host-`node_modules` ins
  Linux-Image gelangt und die Frisch-Installation im Image nicht überschreibt.

## Betroffene Dateien

| Datei | Beschreibung |
|---|---|
| `Containerfile` | Neu, im Repo-Root. Multi-Stage: Build-Stage (Node + pnpm + Rust) baut Packages, native Binary und alle Examples; Runtime-Stage startet den Supervisor. `EXPOSE` der zehn Ports. |
| `.containerignore` | Neu. Schließt `node_modules/`, `target/`, `**/*.node`, `dist/`, `.git/`, Build-/Cache-Artefakte aus dem Build-Context aus. |
| `scripts/container/start-all.mjs` | Neu. Node-Supervisor: importiert `EXAMPLE_MATRIX`, startet je Example das `start`/`preview`-Skript mit `PORT`/`HOST`-Override, präfixt die Ausgabe, leitet Signale weiter, fail-fast bei unerwartetem Exit. |
| `scripts/container/start-plan.mjs` | Neu. Pure, unit-getestete Helfer für die Host-Override-Logik (getrennt vom I/O-lastigen Supervisor). |
| `scripts/container/start-plan.test.mjs` | Neu. Vitest-Unit-Tests der Host-Override-Logik. |
| `scripts/container/print-podman-ports.mjs` | Neu. Generiert die `-p`-Publish-Flags aus `EXAMPLE_MATRIX`, damit der Run-Befehl nicht vom Matrix-Portlayout abdriftet. |
| `docs/operations/run-examples-container.md` | Neu. Betriebsdoku: Build, Run, Ports, Host-Binding, Ausblick. |
| `package.json` (Root) | Geändert: Script-Alias `container:ports`. |
| `scripts/example-matrix.mjs` | Nur **lesende** Wiederverwendung (Import). Keine Änderung. |
| `examples/react-router-cookie/Dockerfile`, `examples/react-router-route/Dockerfile` | Bestand. Diese Single-App/Vercel-orientierten Dockerfiles bleiben unberührt (siehe Annahmen). |

## Implementierungsdetails

### Vorgehen

1. **`.containerignore` anlegen**, bevor das Image gebaut wird, damit der
   Build-Context schlank und host-frei ist (`node_modules/`, `target/`,
   `**/*.node`, `dist/`, `.git/`, `.output/`, `.next/`, `.vinxi/`, `.nitro/`).
2. **`Containerfile` – Build-Stage** auf glibc-Node-Basis (z. B.
   `node:22-bookworm`, passend zu `engines.node >= 22.22.0`):
   - Rust-Toolchain (rustup, stable ≥ 1.93) + Build-Essentials installieren.
   - `corepack enable` und pnpm auf `11.1.3` fixieren (aus `packageManager`).
   - Gesamtes Workspace kopieren, `pnpm install --frozen-lockfile`.
   - `PALAMEDES_RUST_PROFILE=release pnpm build` (baut Packages inkl. native
     Binary über das Platform-Paket-Build-Skript).
   - `pnpm build:examples` (baut alle zehn Example-Outputs; der Next-Post-Build
     `normalize-next-required-server-files.mjs` läuft dabei aus dem Example-Script).
3. **`Containerfile` – Runtime-Stage** auf `node:22-bookworm-slim`:
   - Das fertige `/app` (Workspace mit `node_modules`, gebauten `packages/*`,
     nativer Binary und Example-Build-Outputs) aus dem Build-Stage übernehmen.
   - `corepack`/pnpm bereitstellen (zum Ausführen der Start-Skripte).
   - `EXPOSE` der zehn Ports.
   - `CMD ["node", "scripts/container/start-all.mjs"]`.
4. **Supervisor `scripts/container/start-all.mjs`**:
   - `EXAMPLE_MATRIX` importieren; über alle Einträge iterieren.
   - Je Example das Start-Skript via `pnpm --filter <package-name> <script>` im
     jeweiligen `cwd` starten, mit `env` = Matrix-`startEnv` plus Container-Override
     (`HOST=0.0.0.0`, `PORT=<port>`), TanStack zusätzlich mit angehängtem
     `-- --host 0.0.0.0`.
   - Kindprozesse in eigener Prozessgruppe starten (analog `detached` in
     `scripts/verify-examples.mjs`), damit ein Signal die gesamte Gruppe erreicht.
   - `SIGTERM`/`SIGINT` an alle Kinder weiterleiten und auf deren Exit warten
     (graceful shutdown), Timeout mit anschließendem `SIGKILL` als Fallback.
   - Fail-fast: Beendet sich ein Kind unerwartet, den Container mit
     Non-Zero-Exit beenden, damit eine Restart-Policy greifen kann.
5. **Build & Run dokumentieren** (in der Umsetzung als kurze Anleitung, kein
   Reverse-Proxy): `podman build -f Containerfile -t palamedes-examples .` und
   `podman run --rm` mit `-p` für alle zehn Ports.

### Host-Binding je Framework

- **Next.js** (`next start`) – bindet standardmäßig `0.0.0.0`; optional explizit
  `-H 0.0.0.0`. In der Umsetzung verifizieren.
- **React Router** (`react-router-serve`) – respektiert `HOST`, Default `0.0.0.0`.
- **Waku** (`waku start`) – `HOST=0.0.0.0` setzen bzw. `--host 0.0.0.0`, falls
  Default nicht `0.0.0.0` ist; in der Umsetzung verifizieren.
- **SolidStart** (`vinxi start`) – `HOST=0.0.0.0` (überschreibt das
  Matrix-`startEnv.HOST=127.0.0.1`), `PORT` aus Matrix.
- **TanStack** (`vite preview`) – zusätzliches `--host 0.0.0.0` anhängen (letzte
  `--host`-Angabe gewinnt); `--port` bleibt aus dem Skript.

### Edge Cases

- **Falsche libc:** Alpine/musl-Basis würde die Native-Binary nicht ohne
  Cross-Target bauen. → glibc-Basis wählen (Architekturentscheidung).
- **Host-Artefakte im Build-Context:** eine macOS-/arm64-`.node` oder Host-
  `node_modules` dürfen nicht ins Image kopiert werden. → `.containerignore`
  schließt `**/*.node`, `node_modules/`, `target/` aus; die Native-Binary
  entsteht frisch im Image.
- **Ein Server crasht:** fail-fast + Non-Zero-Exit, damit `podman`/eine
  Restart-Policy den Container neu startet statt teilweise weiterzulaufen.
- **Graceful Shutdown:** `podman stop` sendet `SIGTERM`; der Supervisor muss es
  an alle zehn Kinder weiterleiten, sonst greift erst der Kill-Timeout.
- **Ressourcen:** zehn SSR-Node-Server gleichzeitig brauchen spürbar RAM/CPU; in
  der Anleitung als Hinweis vermerken (ggf. Container-Limits).
- **Build-Dauer:** der `cargo`-Release-Build verlängert den Image-Build; als
  erwartetes Verhalten dokumentieren.

## Akzeptanzkriterien

- [ ] `podman build -f Containerfile -t palamedes-examples .` läuft ohne Fehler
      durch (native Binary gebaut, alle zehn Examples gebaut).
- [ ] `podman run` mit den zehn publizierten Ports startet einen Container, in
      dem alle zehn Server gleichzeitig laufen.
- [ ] Für jeden der zehn Ports liefert ein HTTP-Request **vom Host** (über den
      publizierten Port) HTTP-Status ≥ 200 auf `/` (Cookie-Strategie) bzw. `/en`
      (Route-Strategie).
- [ ] Alle Server lauschen auf `0.0.0.0` und sind über den publizierten Port von
      außerhalb des Containers erreichbar (nicht nur `127.0.0.1`).
- [ ] `podman stop` beendet den Container sauber; alle zehn Kindprozesse werden
      per weitergeleitetem `SIGTERM` terminiert.
- [ ] Keine Änderung an den Beispiel-`package.json`; Ports und Start-Skripte
      stammen weiterhin aus `scripts/example-matrix.mjs`.

## Validierungsplan

- **Image-Build:** `podman build -f Containerfile -t palamedes-examples .`
  erfolgreich.
- **Container-Start:** `podman run --rm` mit `-p 4010:4010 … -p 4051:4051`.
- **Port-Health je App:** HTTP-Check gegen alle zehn Ports (Status ≥ 200) auf
  `/` bzw. `/en`; optional die vorhandenen Smoke-Substrings aus
  `scripts/example-matrix.mjs` wiederverwenden, um lokalisierte Inhalte zu prüfen.
- **0.0.0.0-Binding:** Zugriff über die publizierte Port-Adresse bestätigt das
  externe Binding (insb. für SolidStart und TanStack).
- **Shutdown:** `podman stop <id>` beendet den Container innerhalb des
  Grace-Timeouts ohne verwaiste Prozesse.

## Ziel/Ausblick (nicht Teil dieses Plans)

- Ein externer Reverse-Proxy (z. B. Caddy/Traefik/nginx) mappt später jede App
  auf eine eigene Domain. Weil jede App bereits einen festen, eindeutigen Port
  hat, ist dafür nur eine Proxy-Konfiguration nötig – keine Änderung an diesem
  Container.
- Optionaler Betrieb des Containers als systemd-Dienst über eine Podman-Quadlet
  `.container`-Unit. Bewusst nicht Teil dieses Plans (Entscheidung: „Nur
  Containerfile").

## Annahmen und offene Punkte

- **glibc/Debian-Basis** mit Rust stable ≥ 1.93 im Build-Stage (Annahme; kein
  Alpine).
- **Alle zehn Examples** werden im Container ausgeführt; `deployable: false` in
  der Matrix betrifft nur Vercel, nicht den Container.
- **Bestehende `examples/react-router-*/Dockerfile`** bleiben unangetastet und
  werden nicht mit dem neuen Monorepo-Containerfile konsolidiert (Annahme; könnte
  später separat aufgeräumt werden).
- **Beispiel-Dateien werden nicht editiert**; Host-Overrides liegen zentral im
  Supervisor.
- **Kein Reverse-Proxy, kein Domain-Mapping, keine TLS-Terminierung** in diesem
  Plan.
- Offen (in der Umsetzung zu verifizieren): exaktes Default-Host-Verhalten von
  `waku start` und `next start` im Container; ob `waku start`/`next start` ein
  `--host`-Flag bzw. `HOST`-Env sauber annehmen.

## Plan-Review

**Ergebnis:** Freigegeben

### Zusammenfassung

| Bereich | Kritisch | Wichtig | Hinweis |
|---|---:|---:|---:|
| Architektur | 0 | 0 | 1 |
| Security | 0 | 0 | 1 |
| Datenschutz | 0 | 0 | 0 |
| Fehlerfälle | 0 | 0 | 1 |
| Testbarkeit | 0 | 0 | 0 |
| Scope | 0 | 0 | 1 |
| Wartbarkeit | 0 | 0 | 1 |

### Befunde

- **Architektur (Hinweis):** Der Runtime-Stage übernimmt das komplette Workspace
  inkl. `node_modules`. Für einen Demo-/Proof-Host ist das akzeptabel; ein
  späteres Prunen (nur benötigte Outputs) ist eine optionale Größenoptimierung,
  nicht Teil des Erstwurfs.
- **Security (Hinweis):** Der Container veröffentlicht zehn ungeschützte
  HTTP-Ports ohne Auth/TLS. Für einen internen Demo-Betrieb hinter einem späteren
  Reverse-Proxy vertretbar; TLS/Zugriffsschutz gehören in die (ausgeklammerte)
  Proxy-Schicht.
- **Fehlerfälle (Hinweis):** Fail-fast beendet den ganzen Container, wenn ein
  einzelner Server stirbt. Bewusst gewählt für klare Restart-Semantik; eine
  granularere Per-App-Restart-Strategie wäre eine spätere Erweiterung.
- **Scope (Hinweis):** Reverse-Proxy, Domain-Mapping und Quadlet-Unit sind klar
  als „nicht Teil" markiert und nur als Ziel/Ausblick geführt – kein Scope Creep.
- **Wartbarkeit (Hinweis):** Die Host-Override-Logik für SolidStart/TanStack lebt
  im Supervisor statt in der Matrix. Das hält die Matrix frei von Deploy-Details;
  Preis ist eine kleine, dokumentierte Sonderbehandlung für zwei Frameworks.

## Testergebnisse

- **Lint:** `oxlint` und `eslint` über `scripts/container/` fehlerfrei.
- **Unit-Tests:** `vitest run scripts/container/start-plan.test.mjs` – 7/7 grün
  (Host-Override je Framework, `--`-Weitergabe, HOST/PORT-Override inkl.
  Loopback-Überschreibung).
- **Port-Generator:** `node scripts/container/print-podman-ports.mjs` liefert die
  erwarteten zehn `-p`-Flags.
- **Nicht in dieser Umgebung ausführbar (offen, vom Anwender zu verifizieren):**
  `podman` war in der Umsetzungsumgebung nicht installiert. Die containerbezogenen
  Akzeptanzkriterien – `podman build`, `podman run`, HTTP-200 je Port, externes
  `0.0.0.0`-Binding (insb. Waku 4030/4031 und TanStack), sauberer `podman
  stop` – müssen in einer Umgebung mit Podman geprüft werden.

## Review-Findings

**Datum:** 2026-07-02
**Reviewer:** sf-nodejs-reviewer

### Zusammenfassung

| Status | Anzahl |
|---|---:|
| Behoben | 10 |
| Offen / Nicht umgesetzt | 0 |

Alle Findings wurden im Rahmen dieses Laufs behoben: 1 kritisches (TanStack-
Host-Override lief Gefahr, über den Vite-cac-Parser als Array zu binden → jetzt
direkter `vite preview`-Aufruf mit einzelnem `--host`), 1 wichtiges (Port-Drift →
`print-podman-ports.mjs` generiert die `-p`-Flags, Doku-Widerspruch bereinigt)
sowie 8 Hinweise (non-root `USER node`, `tini`-Entrypoint, Log-Flush vor Exit,
Next.js-Testfall, react-router-`PORT`-Doku, Waku-Kommentar entschärft, Restart-
Policy dokumentiert, Build-Cache-Bereinigung). Keine offenen Findings – kein
externer Review-Report nötig.
