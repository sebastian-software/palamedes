# Palamedes vs. Lingui

Lingui ist eine der besseren i18n-Lösungen im JavaScript-Ökosystem. Viele Ideen, die Palamedes wichtig sind, sind davon inspiriert: Makros statt String-Chaos, saubere Message-Deskriptoren, gute Extractor-Story und pragmatische Framework-Integration.

Palamedes ist trotzdem nicht einfach "Lingui in neuem Gewand". Das Projekt nimmt dieselben Grundideen und baut darauf eine konsequentere Architektur: nativer Core, weniger historischer Ballast, ein klareres Runtime-Modell und ein kleinerer Transform-Stack.

Wenn du heute neu startest oder ein bestehendes Setup vereinfachen willst, halten wir Palamedes für die bessere Default-Wahl.

## Kurzvergleich

| Thema | Lingui | Palamedes |
|---|---|---|
| Grundidee | starke Macro-basierte i18n-Lösung | gleiche Kernidee, aber architektonisch vereinfacht |
| Transform-Core | historisch stärker JS-/Babel-geprägt | nativer Rust-Core mit dünnen TS-Wrappern |
| Message-Identität | historisch mit mehr API-Oberfläche und Altpfaden | konsequent source-string-first (`message + context`) |
| Runtime-Modell | mehrere gewachsene Zugriffspfade | ein Zielmodell: `getI18n()` |
| Framework-Integration | gut, aber stärker vom Lingui-Modell geprägt | auf den nativen Core ausgerichtete Vite-/Next-Adapter |
| Source Maps | Teil des Tooling-Stapels | immer Teil des Transform-Ergebnisses |
| Produktziel | breite Lingui-Kompatibilität | bewusst opinionated, schlanker Endzustand |

## Warum wir Palamedes für die bessere Default-Wahl halten

### 1. Gleiche gute Grundidee, klarere Architektur

Lingui hat die richtige Richtung früh vorgegeben: Makros, Message-Deskriptoren und Extraction statt manueller String-Verwaltung.

Palamedes übernimmt genau diese Stärken, trennt sich aber von einem Teil der historischen Last. Der Kern liegt heute in Rust, die Node- und TypeScript-Schichten sind bewusst dünn, und die Transform-Entscheidungen leben nicht mehr in mehreren halbparallelen Implementierungen.

Das macht den Stack leichter zu verstehen und leichter zu warten.

### 2. Ein Runtime-Modell statt mehrerer Denkweisen

Palamedes setzt auf ein klares Zielmodell: `getI18n()`.

Das ist mehr als nur ein anderer API-Name. Es entfernt die alte Unterscheidung zwischen verschiedenen Zugriffspfaden und macht die eigentliche Frage sichtbar: "Wie komme ich in dieser Umgebung an die aktive i18n-Instanz?"

Das Ergebnis:

- weniger mentale Verzweigungen
- klarere Transform-Ausgabe
- weniger Spezialfälle in Client-/Server-Code

### 3. Nativer Core statt wachsender JS-Sonderpfade

Palamedes transformiert und extrahiert heute über einen nativen Core. Die TypeScript-Schicht existiert noch, aber sie ist keine zweite Produktlogik mehr.

Das zahlt sich an mehreren Stellen aus:

- weniger doppelte Implementierungen
- weniger Drift zwischen "eigentlich" und "Fallback"
- klarere Ownership im Code
- einfachere Weiterentwicklung in Richtung Packaging, Benchmarks und Releases

### 4. Bessere Endstate-Disziplin

Lingui muss naturgemäß Rücksicht auf eine große existierende Welt nehmen. Das ist verständlich und oft richtig.

Palamedes hat diesen Druck nicht in derselben Form. Dadurch können wir Entscheidungen schneller zu Ende führen:

- alte Zugriffspfade nicht ewig mitschleppen
- Transform und Extractor auf einen klaren Zielzustand zuschneiden
- API-Flächen eher verkleinern als ausweiten

Wenn du eine moderne i18n-Toolchain für ein neues Projekt willst, ist das ein Vorteil, nicht ein Nachteil.

## Was Palamedes konkret besser macht

### Ein nativer Transform- und Extractor-Kern

Palamedes nutzt einen Rust-Core für:

- Macro-Transform
- Message-Extraction
- PO-Verarbeitung über den nativen Stack
- Catalog-Update und Parse-Semantik über `ferrocat`

Das reduziert den Anteil an JavaScript-Infrastruktur im kritischsten Teil der Toolchain.

### Ein konsequenteres Message-Modell

Palamedes behandelt `message + context` als einzige fachliche Identität.

Das bedeutet:

- keine author-facing expliziten IDs
- source-string-first Catalogs und Diagnostics
- kompakte Hash-Keys nur noch als internes Compile-/Runtime-Detail

Damit bleibt das Modell näher an gettext und gleichzeitig klarer als eine Mischung aus Source-Strings und separaten Produkt-IDs.

### Immer erzeugte Source Maps

Source Maps sind in Palamedes kein optionaler Nebengedanke mehr. Der Transform liefert sie bei Änderungen immer mit.

Das ist wichtig für:

- Vite-Integration
- nachvollziehbare Fehlerpositionen
- saubere Tooling-Ketten nach dem Rewrite

### Ein bewusst kleineres Produktmodell

Palamedes will nicht jede historische Form gleichzeitig konservieren. Das Projekt bevorzugt:

- einen klaren Runtime-Pfad
- weniger Sonderfälle
- weniger "für alle Fälle noch kompatibel"

Das macht das System strenger, aber auch lesbarer.

## Was gleich bleibt

Palamedes ist kein kompletter Neuanfang ohne Wiedererkennung. Wenn du von Lingui kommst, bleiben viele Grundmuster vertraut:

- Makro-orientiertes Arbeiten
- `t`, `msg`, `defineMessage`
- `plural`, `select`, `selectOrdinal`
- `<Trans>`, `<Plural>`, `<Select>`, `<SelectOrdinal>`
- Catalog-/Extraction-Denke statt inline Übersetzungschaos

Gerade deshalb ist Palamedes als Migration attraktiv: du behältst viele gute Arbeitsweisen, aber mit einer aufgeräumteren Unterseite.

## Wann Lingui weiterhin okay ist

Lingui bleibt eine starke Wahl, besonders wenn:

- du bereits tief in Lingui investiert bist
- du maximale Kompatibilität mit bestehender Lingui-Dokumentation willst
- du bewusst im etablierten Lingui-Ökosystem bleiben willst

Palamedes ist nicht die Aussage, dass Lingui schlecht sei. Palamedes ist die Aussage, dass man dieselben Grundideen heute noch klarer, nativer und entschlossener bauen kann.

## Empfehlung

- Wenn du ein bestehendes großes Lingui-System nur minimal anfassen willst: Lingui weiterfahren kann sinnvoll sein.
- Wenn du neu startest oder gerade sowieso Architekturarbeit machst: Palamedes ist aus unserer Sicht die bessere Default-Wahl.

Weiter geht es hier:

- [Migration from Lingui](./migrate-from-lingui.md)
