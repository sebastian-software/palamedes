# Migration von Lingui zu Palamedes

Diese Migration ist in vielen Teilen einfacher, als sie auf den ersten Blick wirkt.

Der Grund: Palamedes verwirft nicht die guten Grundideen von Lingui, sondern baut darauf auf. Viele Macro-Formen bleiben vertraut. Der Umstieg betrifft vor allem Tooling, Runtime-Modell und das Entfernen einiger älterer Zugriffspfade.

## Die kurze Version

In den meisten Projekten sieht die Migration so aus:

1. Framework-Integration auf Palamedes umstellen
2. Extraction auf Palamedes umstellen
3. Runtime-Zugriff auf `getI18n()` ausrichten
4. explizite `id`-Authoring-Pfade entfernen
5. alte accessor-spezifische Pfade entfernen
6. Build, Extraction und App-Verhalten verifizieren

## Konzept-Mapping

| Lingui-Welt | Palamedes-Welt |
|---|---|
| Lingui als komplette Produktoberfläche | Palamedes als Tooling- und Runtime-Oberfläche |
| gemischte historische API-Oberfläche | bewusst kleinerer, opinionated Endzustand |
| Message-Identität teils mit expliziten `id`-Pfaden | `message + context` als einzige fachliche Identität |
| mehrere Zugriffspfade je nach Kontext | ein Zielmodell über `getI18n()` |
| Framework-Setup über Lingui-Adapter | Framework-Setup über `@palamedes/vite-plugin` oder `@palamedes/next-plugin` |
| Extraction über Lingui-CLI/Babel-orientierte Wege | Extraction über `@palamedes/extractor` und `pmds extract` |

## Was du meistens behalten kannst

Viele Macro-Formen bleiben zunächst gleich:

```ts
import { t, msg, defineMessage, plural, select, selectOrdinal } from "@lingui/core/macro"
```

```tsx
import { Trans, Plural, Select, SelectOrdinal } from "@lingui/react/macro"
```

Auch die semantische Arbeitsweise bleibt ähnlich:

- Messages über Makros definieren
- Messages extrahieren
- Catalogs pflegen
- Runtime-Auflösung zentral halten

## Was du bewusst ändern solltest

### 1. Alte Zugriffspfade entfernen

Palamedes trägt keine separaten accessor-spezifischen Pfade mehr als bevorzugtes Modell.

Wenn dein Code noch von einem alten Zugriffsmuster ausgeht, stelle ihn auf das Runtime-Zielmodell um:

```ts
import { getI18n } from "@palamedes/runtime"
```

Dann arbeitet der Rest des Systems gegen dieselbe Grundannahme.

### 2. Explizite `id`-Authoring-Pfade entfernen

Palamedes ist source-string-first. Wenn dein Projekt Stellen wie diese nutzt, müssen sie vor oder während der Migration verschwinden:

```ts
t({ id: "checkout.cta", message: "Buy now" })
defineMessage({ id: "checkout.cta", message: "Buy now" })
```

Stattdessen gilt in Palamedes:

- `message` ist der Source String
- `context` disambiguiert bei Bedarf
- `message + context` ist die fachliche Identität

Das passt besser zu gettext und hält Catalogs, Diagnostics und Transform-Modell konsistent.

### 3. Framework-Integration austauschen

#### Vite

Vorher:

```ts
// vite.config.ts
// Lingui-spezifisches Setup
```

Nachher:

```ts
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  plugins: [palamedes()],
})
```

#### Next.js

Vorher:

```ts
// next.config.ts
// Lingui-spezifisches Setup
```

Nachher:

```ts
import { withPalamedes } from "@palamedes/next-plugin"

export default withPalamedes(nextConfig)
```

### 4. Extraction umstellen

Mit Palamedes läuft die Extraction über die eigene Toolchain:

```bash
pnpm exec pmds extract
```

Wenn du Watch-Modus willst:

```bash
pnpm exec pmds extract --watch
```

## Typische Before/After-Beispiele

### Direktes Macro bleibt direktes Macro

Vorher:

```ts
import { t } from "@lingui/core/macro"

const title = t`Hello`
```

Nachher:

```ts
import { t } from "@lingui/core/macro"

const title = t`Hello`
```

Der Unterschied liegt hier nicht im Callsite-Code, sondern im Tooling darunter.

### Runtime-Zugriff auf das neue Modell ziehen

Vorher:

```ts
// alter kontextabhängiger Zugriffspfad
```

Nachher:

```ts
import { getI18n } from "@palamedes/runtime"

const locale = getI18n().locale
```

### JSX-Makros bleiben vertraut

Vorher:

```tsx
import { Trans, Plural } from "@lingui/react/macro"

export function Example() {
  return (
    <>
      <Trans>Hello {name}</Trans>
      <Plural value={count} one="# item" other="# items" />
    </>
  )
}
```

Nachher:

```tsx
import { Trans, Plural } from "@lingui/react/macro"

export function Example() {
  return (
    <>
      <Trans>Hello {name}</Trans>
      <Plural value={count} one="# item" other="# items" />
    </>
  )
}
```

Auch hier liegt die Veränderung primär im Stack darunter, nicht in der Surface-Syntax.

## Breaking Changes, die du einplanen solltest

### `getI18n()` ist das Zielmodell

Palamedes ist opinionated. Wenn dein Projekt stark auf mehrere historische Zugriffspfade aufbaut, solltest du diese Vereinheitlichung bewusst einplanen.

### Explizite Authoring-IDs werden nicht mehr mitgetragen

Palamedes behandelt explizite `id`-Felder nicht mehr als reguläres Authoring-Modell.

Wenn dein bisheriger Code solche Felder verwendet, plane die Umstellung bewusst ein, statt auf stillschweigende Kompatibilität zu hoffen.

### Tooling-Namen ändern sich

Du migrierst nicht nur Implementierungsdetails, sondern auch Produktoberflächen:

- `@palamedes/extractor`
- `@palamedes/transform`
- `@palamedes/vite-plugin`
- `@palamedes/next-plugin`
- `@palamedes/runtime`
- `pmds` für die CLI

### Weniger Kompatibilitätsballast

Palamedes versucht nicht, jede alte Form ewig mitzuziehen. Das ist gut für den Endzustand, aber es bedeutet auch: Migration lieber bewusst und sauber erledigen statt auf stilles Weiterfunktionieren zu hoffen.

## Empfohlene Reihenfolge für echte Projekte

### Kleine oder neue Projekte

1. Tooling-Pakete austauschen
2. Runtime auf `getI18n()` ausrichten
3. Extraction laufen lassen
4. Build und App testen

### Größere bestehende Projekte

1. Framework-Integration austauschen
2. Runtime-Zugriffe inventarisieren
3. alte Zugriffspfade entfernen
4. Extraction validieren
5. App-Verhalten pro Route/Feature prüfen

## Done-Checkliste

- Build läuft mit Palamedes-Plugin
- Extraction läuft über `pmds`
- Runtime-Zugriff ist auf `getI18n()` ausgerichtet
- keine expliziten `id`-Authoring-Pfade mehr im Projekt
- Catalogs werden korrekt erzeugt oder aktualisiert
- Fehlerpositionen und Source Maps funktionieren im Dev-Tooling
- keine alten accessor-spezifischen Muster mehr im Projekt

## Warum sich die Migration lohnt

Wenn du von Lingui kommst, bekommst du mit Palamedes nicht "weniger Lingui", sondern die konzentriertere nächste Stufe derselben guten Idee:

- nativer Core
- kleinerer Transform-Stack
- immer erzeugte Source Maps
- klareres Runtime-Modell
- weniger historischer Ballast

Wenn du ohnehin über Tooling, Build-Zeit, Wartbarkeit oder Runtime-Klarheit nachdenkst, ist das ein guter Zeitpunkt für den Wechsel.

Weiterlesen:

- [Palamedes vs. Lingui](./comparison-with-lingui.md)
