import React from "react";
import { IntlProvider } from "react-intl";

type IntlMessages = Record<string, string>;
type IntlMessageCatalogs = Record<string, IntlMessages>;

export interface SharedIntlConfig {
  defaultLocale?: string;
  locale?: string;
  messages?: IntlMessages | IntlMessageCatalogs;
}

interface IntlErrorLike {
  code?: string;
}

function normalizeLocale(locale: string) {
  return locale.replace(/_/g, "-");
}

function getLocaleCandidates(locale: string) {
  const normalizedLocale = normalizeLocale(locale);
  const languageCode = normalizedLocale.split("-")[0];

  if (languageCode === normalizedLocale) {
    return [normalizedLocale];
  }

  return [normalizedLocale, languageCode];
}

function resolveLocaleFromDocument() {
  if (typeof document !== "undefined") {
    const documentLocale = document.documentElement.lang || document.body?.parentElement?.lang;
    if (documentLocale) {
      return documentLocale;
    }
  }

  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }

  return "en";
}

function isDirectMessageMap(messages: IntlMessages | IntlMessageCatalogs): messages is IntlMessages {
  return Object.values(messages).every((value) => typeof value === "string");
}

function resolveMessages(
  locale: string,
  defaultLocale: string,
  messages?: IntlMessages | IntlMessageCatalogs,
) {
  if (!messages) {
    return {};
  }

  if (isDirectMessageMap(messages)) {
    return messages;
  }

  const localeCandidates = [
    ...getLocaleCandidates(locale),
    ...getLocaleCandidates(defaultLocale),
  ];

  for (let index = 0; index < localeCandidates.length; index += 1) {
    const candidate = localeCandidates[index];
    if (messages[candidate]) {
      return messages[candidate];
    }
  }

  return {};
}

function handleIntlError(error: IntlErrorLike) {
  if (error.code === "MISSING_TRANSLATION") {
    return;
  }

  if (typeof console !== "undefined" && typeof console.error === "function") {
    console.error(error);
  }
}

export function resolveIntlConfig(config?: SharedIntlConfig) {
  const defaultLocale = normalizeLocale(config?.defaultLocale || "en");
  const locale = normalizeLocale(config?.locale || resolveLocaleFromDocument() || defaultLocale);

  return {
    defaultLocale,
    locale,
    messages: resolveMessages(locale, defaultLocale, config?.messages),
  };
}

export function SharedIntlProvider({
  children,
  config,
}: React.PropsWithChildren<{ config?: SharedIntlConfig }>) {
  const intlConfig = resolveIntlConfig(config);

  return (
    <IntlProvider
      defaultLocale={intlConfig.defaultLocale}
      locale={intlConfig.locale}
      messages={intlConfig.messages}
      onError={handleIntlError}
    >
      {children}
    </IntlProvider>
  );
}
