import type { NextConfig } from "next";

const isGithubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(isGithubPages
    ? {
        output: "export",
        basePath: "/freeting",
        images: { unoptimized: true },
      }
    : {
        async headers() {
          return [
            {
              source: "/(.*)",
              headers: [
                {
                  key: "Referrer-Policy",
                  value: "no-referrer",
                },
                {
                  key: "X-Content-Type-Options",
                  value: "nosniff",
                },
                {
                  key: "X-Frame-Options",
                  value: "DENY",
                },
                {
                  key: "Permissions-Policy",
                  value:
                    "camera=(self), microphone=(self), display-capture=(self), geolocation=()",
                },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
