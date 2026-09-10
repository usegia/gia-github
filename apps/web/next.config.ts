import type { NextConfig } from "next";

const config: NextConfig = {
  // The checked-in AGENTS.md owns the startup path, including bundled Next.js documentation.
  agentRules: false,
  poweredByHeader: false,
  transpilePackages: ["@gia-github/search", "@gia-github/db"],
  serverExternalPackages: ["pg"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default config;
