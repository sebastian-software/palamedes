import { randomBytes } from "node:crypto";

import { createController } from "remix/router";
import { createElement } from "remix/component";
import { renderToString } from "remix/component/server";

import {
  getLocaleLabel,
  normalizeLocale,
  remixI18n,
  resolveLocaleFromRequest,
  serializeLocaleCookie,
} from "../i18n.ts";
import { renderFrameContent, renderFrameDocument } from "../frame-page.tsx";
import { renderHomePage } from "../page.ts";
import { ClientProof } from "../public/interactive.tsx";
import { routes } from "../routes.ts";
import { assetServer } from "../assets.ts";

export default createController(routes, {
  actions: {
    home(context) {
      return remixI18n.run(context, async ({ locale, source }) => {
        const nonce = randomBytes(18).toString("base64");
        return new Response(
          renderHomePage({
            clientCatalog: remixI18n.renderClientCatalog(locale),
            clientEntry: await remixI18n.renderClientEntry("app/public/client.tsx", {
              assetServer,
              nonce,
            }),
            clientProof: await renderToString(
              createElement(ClientProof, { audience: "developer", count: 1 }),
            ),
            locale,
            hasLocaleChoice: source === "cookie",
            localeLabel: getLocaleLabel(normalizeLocale(locale)),
            strategyLabel: "cookie",
          }),
          {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "content-security-policy": `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'`,
              vary: "Cookie, Accept-Language",
              "x-palamedes-locale": locale,
            },
          },
        );
      });
    },

    frameDocument(context) {
      return remixI18n.run(context, ({ locale }) => {
        const normalizedLocale = normalizeLocale(locale);
        return new Response(
          renderFrameDocument({
            locale: normalizedLocale,
            localeLabel: getLocaleLabel(normalizedLocale),
            request: context.request,
          }),
          {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "x-palamedes-locale": normalizedLocale,
              vary: "Host, Cookie, Accept-Language",
            },
          },
        );
      });
    },

    frameLocaleSummary(context) {
      return remixI18n.run(context, ({ locale }) => {
        const normalizedLocale = normalizeLocale(locale);
        return new Response(
          renderFrameContent({
            locale: normalizedLocale,
            localeLabel: getLocaleLabel(normalizedLocale),
          }),
          {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "x-palamedes-locale": normalizedLocale,
              vary: "Host, Cookie, Accept-Language",
            },
          },
        );
      });
    },

    async setLocale(context) {
      const resolved = resolveLocaleFromRequest(context.request);
      const formData = await context.request.formData();
      const locale = normalizeLocale(formData.get("locale") ?? resolved.locale);
      const headers = new Headers({ location: "/" });
      if (resolved.source !== "cookie" || resolved.locale !== locale) {
        headers.set("set-cookie", serializeLocaleCookie(locale));
      }

      return new Response(null, {
        status: 303,
        headers,
      });
    },
  },
});
