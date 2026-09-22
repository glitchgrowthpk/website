import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The whole site is prerendered, so we emit plain HTML/CSS/JS into `out/`.
   * That is what gets uploaded to Bluehost — Apache serves it directly and no
   * Node process is needed on the host.
   */
  output: "export",

  /**
   * Next's image optimiser needs a running server. The game icons are already
   * shipped as 256px WebP (~18KB each), so serving them as-is costs nothing.
   */
  images: { unoptimized: true },

  /**
   * Emits `out/index.html` style directories, which Apache resolves via
   * DirectoryIndex without any rewrite rules.
   */
  trailingSlash: true,
};

export default nextConfig;
