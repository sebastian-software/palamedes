"use client";

export function LocaleSwitcher({ locale }: { locale: string }) {
  return (
    <div role="group" aria-label="Language">
      {(["en", "de", "fr"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={locale === value}
          data-testid={`locale-${value}`}
          onClick={() => {
            document.cookie = `locale=${value}; Path=/; SameSite=Lax`;
            window.location.reload();
          }}
        >
          {{ en: "English", de: "Deutsch", fr: "Français" }[value]}
        </button>
      ))}
    </div>
  );
}
