import { randomBytes } from "node:crypto";

import { createController } from "remix/router";
import { createElement } from "remix/component";
import { renderToString } from "remix/component/server";

import { assetServer } from "../assets.ts";
import { ClientProof } from "../public/interactive.tsx";
import { renderFrameContent, renderFrameDocument } from "../frame-page.tsx";

import {
  getLocaleLabel,
  getTldBanner,
  getTldSwitchLinks,
  locales,
  normalizeLocale,
  remixI18n,
  resolveLocaleRedirect,
} from "../i18n.ts";
import { renderHomePage } from "../page.ts";
import { routes } from "../routes.ts";

export default createController(routes, {
  actions: {
    home(context) {
      return remixI18n.run(context, async ({ locale }) => {
        const nonce = randomBytes(18).toString("base64");
        return new Response(
          renderHomePage({
            clientCatalog: remixI18n.renderClientCatalog(locale),
            clientEntry: await remixI18n.renderClientEntry("app/public/client.tsx", {
              assetServer,
              nonce,
            }),
            clientProof: await renderToString(
              createElement(ClientProof, {
                audience: "developer",
                count: 1,
                framesHref: "/frames",
              }),
            ),
            framesHref: "/frames",
            banner: getTldBanner(context.request, locale),
            locale,
            localeLabel: getLocaleLabel(normalizeLocale(locale)),
            strategyLabel: "tld",
            switchLinks: getTldSwitchLinks(context.request),
          }),
          {
            headers: {
              "content-type": "text/html; charset=utf-8",
              "content-security-policy": `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'`,
              "x-palamedes-locale": locale,
              vary: "Host, Cookie, Accept-Language",
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
      const formData = await context.request.formData();
      const locale = normalizeLocale(formData.get("locale"));
      const redirect = formData.get("redirect");
      return new Response(null, {
        status: 303,
        headers: {
          location: resolveLocaleRedirect(context.request, locale, redirect, "/"),
          "set-cookie": locales.serializeChoice(locale),
        },
      });
    },
  },
});
