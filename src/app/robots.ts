import type { MetadataRoute } from "next";

// Required by `output: "export"` — baked at build time.
export const dynamic = "force-static";

const SITE = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://glitchtech.games"
).replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE}/sitemap.xml`,
  };
}
