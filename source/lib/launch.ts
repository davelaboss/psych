import { env } from 'cloudflare:workers';

export function realStorefrontEnabled(): boolean {
  return (env as unknown as { REAL_STOREFRONT_ENABLED?: string }).REAL_STOREFRONT_ENABLED === 'true';
}
