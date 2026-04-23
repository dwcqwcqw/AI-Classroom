import type { NextConfig } from 'next';

const isCloudflare =
  process.env.CLOUDFLARE === '1' ||
  process.env.CF_PAGES === '1' ||
  process.env.NEXT_RUNTIME_TARGET === 'cloudflare';

const nextConfig: NextConfig = {
  output: process.env.VERCEL || isCloudflare ? undefined : 'standalone',
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  serverExternalPackages: ['sharp'],
  images: {
    unoptimized: true,
  },
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
  async headers() {
    const extraAncestors = process.env.ALLOWED_FRAME_ANCESTORS?.trim();
    const frameAncestors = extraAncestors ? `'self' ${extraAncestors}` : "'self'";

    return [
      {
        source: '/(.*)',
        headers: [
          // X-Frame-Options only supports SAMEORIGIN (no allow-list),
          // so we omit it when custom ancestors are configured.
          ...(!extraAncestors ? [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }] : []),
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors ${frameAncestors}`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
