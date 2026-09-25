import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ssh2 loads an optional native addon, which Turbopack cannot place in an
  // ESM chunk ("non-ecmascript placeable asset"). Leaving it external means it
  // is required at runtime instead of bundled — the standard treatment for a
  // package with native bindings, and it only ever runs server-side (the
  // vintage photo share listing).
  serverExternalPackages: ["ssh2", "ssh2-sftp-client"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.shopify.com",
      },
    ],
  },
};

export default nextConfig;
