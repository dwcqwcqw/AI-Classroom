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
};

export default nextConfig;
