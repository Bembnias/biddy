import type { MetadataRoute } from 'next';

import { config } from '@/config';

/** Indeksowanie tylko na produkcji; staging i preview są dla wyszukiwarek zamknięte. Sitemap: F-19. */
export default function robots(): MetadataRoute.Robots {
  if (config.environment !== 'production') {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    rules: { userAgent: '*', allow: '/' },
    host: config.siteUrl,
    sitemap: new URL('/sitemap.xml', config.siteUrl).toString(),
  };
}
