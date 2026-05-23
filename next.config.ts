import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
    serverActions: { bodySizeLimit: "2mb" },
  },
  logging: { fetches: { fullUrl: false } },
  poweredByHeader: false,
};

export default nextConfig;
