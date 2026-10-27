/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No "X-Powered-By: Next.js" advertising the stack.
  poweredByHeader: false,
  // The e2e suite runs its own dev server with test credentials; a separate
  // build directory keeps it from clobbering a developer's `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  eslint: { dirs: ['app', 'components', 'lib', 'e2e'] },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co', pathname: '/storage/v1/object/public/**' },
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  // @react-pdf/renderer ships native-ish deps that must stay external on the server runtime.
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
};

export default nextConfig;
