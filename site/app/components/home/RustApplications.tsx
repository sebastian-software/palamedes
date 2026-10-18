import { ButtonLink } from "@palamedes/site-ui";
import { Band, BandHeader } from "~/components/marketing/Band";
import { CodeBlock } from "~/components/marketing/CodeBlock";
import { repoHref } from "~/data/links";

const RUST_GREETING = `include!(concat!(env!("OUT_DIR"), "/messages.rs"));

// Inside your application's fallible entry point:
let catalog = palamedes_i18n::Catalog::load(
    "translations/de.pmd.json", "de", CATALOG_SCHEMA,
)?;
println!("{}", translate!(
    &catalog, "Hello {name}!", name = "Ada"
)?);
// Hallo Ada!`;

export function RustApplications() {
  return (
    <Band id="rust-applications" tone="parchment" labelledBy="rust-applications-title">
      <BandHeader
        id="rust-applications-title"
        kicker="Rust applications · Experimental"
        title="Ship another language without rebuilding your Rust app."
        lede="Cargo prepares your PO catalogs as language files. Your executable loads the selected catalog when it runs. All languages, including English, stay outside the binary."
      />
      <div className="mt-12 grid items-start gap-10 lg:grid-cols-2">
        <div className="min-w-0">
          <CodeBlock
            label="Rust application · after Cargo generates the macros"
            code={RUST_GREETING}
            marks={["Hello {name}!", "de.pmd.json"]}
            caption="The Rust compiler checks source messages and argument names. The language file supplies the translated text."
          />
        </div>
        <div className="min-w-0 space-y-6 text-[17px] leading-relaxed text-ink/80">
          <p>
            Keep translations in readable PO catalogs. Compile them during your Cargo build, then
            deliver only the language files your installation needs. Compatible translation edits
            and additional languages can ship without changing the executable; message contract
            changes need matching catalogs.
          </p>
          <p>
            This path is experimental and the crates are unpublished. Text, display arguments, and
            string selects work today. Plurals, localized numbers, dates and times, rich text, and
            translation contexts are not supported yet.
          </p>
          <div className="flex flex-wrap items-center gap-5">
            <ButtonLink href="/docs/rust-applications">Try the Rust guide</ButtonLink>
            <a
              className="pmds-arrow-link text-[15px]"
              href={repoHref("crates/palamedes-i18n/examples/cli", "tree")}
            >
              Inspect the Rust example
            </a>
          </div>
        </div>
      </div>
    </Band>
  );
}
