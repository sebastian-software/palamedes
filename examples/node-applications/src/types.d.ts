declare module "#palamedes/node" {
  export function createNodeI18n(
    options: import("@palamedes/core").CreateI18nOptions & { locale: string },
  ): Promise<import("@palamedes/core").PalamedesI18n>;
}
