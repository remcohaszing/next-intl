import type {Locale} from 'use-intl';
import type {
  DomainConfig,
  DomainsConfig,
  LocalePrefixConfigVerbose,
  LocalePrefixMode,
  Locales,
  Pathnames
} from '../routing/types.js';
import {
  getLocalePrefix,
  getLocalizedTemplate,
  getSortedPathnames,
  matchesPathname,
  normalizeTrailingSlash,
  prefixPathname,
  templateToRegex
} from '../shared/utils.js';

export function getFirstPathnameSegment(pathname: string) {
  return pathname.split('/')[1];
}

export function getInternalTemplate<
  AppLocales extends Locales,
  AppPathnames extends Pathnames<AppLocales>
>(
  pathnames: AppPathnames,
  pathname: string,
  locale: AppLocales[number]
): [AppLocales[number] | undefined, keyof AppPathnames | undefined] {
  const sortedPathnames = getSortedPathnames(Object.keys(pathnames));

  // Try to find a localized pathname that matches
  for (const internalPathname of sortedPathnames) {
    const localizedPathnamesOrPathname = pathnames[internalPathname];
    if (typeof localizedPathnamesOrPathname === 'string') {
      const localizedPathname = localizedPathnamesOrPathname;
      if (matchesPathname(localizedPathname, pathname)) {
        return [undefined, internalPathname];
      }
    } else {
      // Prefer the entry with the current locale in case multiple
      // localized pathnames match the current pathname
      const sortedEntries = Object.entries(localizedPathnamesOrPathname);
      const curLocaleIndex = sortedEntries.findIndex(
        ([entryLocale]) => entryLocale === locale
      );
      if (curLocaleIndex > 0) {
        sortedEntries.unshift(sortedEntries.splice(curLocaleIndex, 1)[0]);
      }

      for (const [entryLocale] of sortedEntries) {
        const localizedTemplate = getLocalizedTemplate(
          pathnames[internalPathname],
          entryLocale,
          internalPathname
        );
        if (matchesPathname(localizedTemplate, pathname)) {
          return [entryLocale, internalPathname];
        }
      }
    }
  }

  // Try to find an internal pathname that matches (this can be the case
  // if all localized pathnames are different from the internal pathnames)
  for (const internalPathname of Object.keys(pathnames)) {
    if (matchesPathname(internalPathname, pathname)) {
      return [undefined, internalPathname];
    }
  }

  // No match
  return [undefined, undefined];
}

export function formatTemplatePathname(
  sourcePathname: string,
  sourceTemplate: string,
  targetTemplate: string,
  prefix?: string
) {
  const params = getRouteParams(sourceTemplate, sourcePathname);
  let targetPathname = '';
  if (prefix) {
    targetPathname = `/${prefix}`;
  }

  targetPathname += formatPathnameTemplate(targetTemplate, params);

  // A pathname with an optional catchall like `/categories/[[...slug]]`
  // should be normalized to `/categories` if the catchall is not present
  // and no trailing slash is configured
  targetPathname = normalizeTrailingSlash(targetPathname);

  return targetPathname;
}

/**
 * Removes potential prefixes from the pathname.
 */
export function getNormalizedPathname<
  AppLocales extends Locales,
  AppLocalePrefixMode extends LocalePrefixMode
>(
  pathname: string,
  locales: AppLocales,
  localePrefix: LocalePrefixConfigVerbose<AppLocales, AppLocalePrefixMode>
) {
  // Add trailing slash for consistent handling
  // both for the root as well as nested paths
  if (!pathname.endsWith('/')) {
    pathname += '/';
  }

  const localePrefixes = getLocalePrefixes(locales, localePrefix);
  const regex = new RegExp(
    `^(${localePrefixes
      .map(([, prefix]) => prefix.replaceAll('/', '\\/'))
      .join('|')})/(.*)`,
    'i'
  );
  const match = pathname.match(regex);

  let result = match ? '/' + match[2] : pathname;
  if (result !== '/') {
    result = normalizeTrailingSlash(result);
  }

  return result;
}

export function findCaseInsensitiveString(
  candidate: string,
  strings: Array<string>
) {
  return strings.find((cur) => cur.toLowerCase() === candidate.toLowerCase());
}

export function getLocalePrefixes<
  AppLocales extends Locales,
  AppLocalePrefixMode extends LocalePrefixMode
>(
  locales: AppLocales,
  localePrefix: LocalePrefixConfigVerbose<AppLocales, AppLocalePrefixMode>,
  sort = true
): Array<[AppLocales[number], string]> {
  const prefixes = locales.map((locale) => [
    locale as AppLocales[number],
    getLocalePrefix(locale, localePrefix)
  ]);

  if (sort) {
    // More specific ones first
    prefixes.sort((a, b) => b[1].length - a[1].length);
  }

  return prefixes as Array<[AppLocales[number], string]>;
}

export function getPathnameMatch<
  AppLocales extends Locales,
  AppLocalePrefixMode extends LocalePrefixMode
>(
  pathname: string,
  locales: AppLocales,
  localePrefix: LocalePrefixConfigVerbose<AppLocales, AppLocalePrefixMode>,
  domain?: DomainConfig<AppLocales>
):
  | {
      locale: AppLocales[number];
      prefix: string;
      matchedPrefix: string;
      exact?: boolean;
    }
  | undefined {
  const localePrefixes = getLocalePrefixes(locales, localePrefix);

  // Sort to prioritize domain locales
  if (domain) {
    localePrefixes.sort(([localeA], [localeB]) => {
      if (localeA === domain.defaultLocale) return -1;
      if (localeB === domain.defaultLocale) return 1;

      const isLocaleAInDomain = domain.locales.includes(localeA);
      const isLocaleBInDomain = domain.locales.includes(localeB);
      if (isLocaleAInDomain && !isLocaleBInDomain) return -1;
      if (!isLocaleAInDomain && isLocaleBInDomain) return 1;

      return 0;
    });
  }

  for (const [locale, prefix] of localePrefixes) {
    let exact, matches;
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      exact = matches = true;
    } else {
      const normalizedPathname = pathname.toLowerCase();
      const normalizedPrefix = prefix.toLowerCase();
      if (
        normalizedPathname === normalizedPrefix ||
        normalizedPathname.startsWith(normalizedPrefix + '/')
      ) {
        exact = false;
        matches = true;
      }
    }

    if (matches) {
      return {
        locale,
        prefix,
        matchedPrefix: pathname.slice(0, prefix.length),
        exact
      };
    }
  }
}

export function getRouteParams(template: string, pathname: string) {
  const normalizedPathname = normalizeTrailingSlash(pathname);
  const normalizedTemplate = normalizeTrailingSlash(template);

  const regex = templateToRegex(normalizedTemplate);
  const match = regex.exec(normalizedPathname);
  if (!match) return undefined;
  const params: Record<string, string> = {};
  for (let i = 1; i < match.length; i++) {
    const key = normalizedTemplate
      .match(/\[([^\]]+)\]/g)
      ?.[i - 1].replace(/[[\]]/g, '');
    if (key) params[key] = match[i];
  }
  return params;
}

export function formatPathnameTemplate(template: string, params?: object) {
  if (!params) return template;

  // Simplify syntax for optional catchall ('[[...slug]]') so
  // we can replace the value with simple interpolation
  template = template.replace(/\[\[/g, '[').replace(/\]\]/g, ']');

  let result = template;
  Object.entries(params).forEach(([key, value]) => {
    result = result.replace(`[${key}]`, value);
  });

  return result;
}

export function formatPathname(
  pathname: string,
  prefix: string | undefined,
  search: string | undefined
) {
  let result = pathname;

  if (prefix) {
    result = prefixPathname(prefix, result);
  }

  if (search) {
    result += search;
  }
  return result;
}

export function getHost(requestHeaders: Headers) {
  return (
    requestHeaders.get('x-forwarded-host') ??
    requestHeaders.get('host') ??
    undefined
  );
}

export function isLocaleSupportedOnDomain<AppLocales extends Locales>(
  locale: Locale,
  domain: DomainConfig<AppLocales>
) {
  return domain.defaultLocale === locale || domain.locales.includes(locale);
}

export function getBestMatchingDomain<AppLocales extends Locales>(
  curHostDomain: DomainConfig<AppLocales> | undefined,
  locale: Locale,
  domainsConfig: DomainsConfig<AppLocales>
) {
  let domainConfig;

  // Prio 1: Stay on current domain
  if (curHostDomain && isLocaleSupportedOnDomain(locale, curHostDomain)) {
    domainConfig = curHostDomain;
  }

  // Prio 2: Use alternative domain with matching default locale
  if (!domainConfig) {
    domainConfig = domainsConfig.find((cur) => cur.defaultLocale === locale);
  }

  // Prio 3: Use alternative domain that supports the locale
  if (!domainConfig) {
    domainConfig = domainsConfig.find((cur) => cur.locales.includes(locale));
  }

  return domainConfig;
}

export function applyBasePath(pathname: string, basePath: string) {
  return normalizeTrailingSlash(basePath + pathname);
}

export function getLocaleAsPrefix<AppLocales extends Locales>(
  locale: AppLocales[number]
) {
  return `/${locale}`;
}

export function sanitizePathname(pathname: string) {
  // Sanitize malicious URIs, e.g.:
  // '/en/\\example.org → /en/%5C%5Cexample.org'
  // '/en////example.org → /en/example.org'
  return pathname.replace(/\\/g, '%5C').replace(/\/+/g, '/');
}
