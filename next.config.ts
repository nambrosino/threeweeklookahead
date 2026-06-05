import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // Allow web-ifc to load its WASM binary
    config.resolve.fallback = { fs: false, path: false };
    return config;
  },
};

export default nextConfig;
