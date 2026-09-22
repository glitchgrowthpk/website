import type { Metadata, Viewport } from "next";
import { Anton, Archivo, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { GAMES } from "@/data/games";
import { STUDIO } from "@/data/studio";

const anton = Anton({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-anton",
  display: "swap",
});

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-face",
  display: "swap",
});

// Set NEXT_PUBLIC_SITE_URL in .env.production to your real domain before the
// deploy build — it drives canonical URLs, Open Graph and JSON-LD.
const SITE = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://glitchtech.games"
).replace(/\/$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "GlitchTech Games — hybrid-casual & puzzle game studio",
    template: "%s · GlitchTech Games",
  },
  description:
    "GlitchTech Games is a hybrid-casual and puzzle game studio in Pakistan. 12 titles shipped, 220K+ installs, 400+ original characters — all made in house. Play a live demo of our match-3 combat loop.",
  keywords: [
    "game studio",
    "hybrid casual games",
    "puzzle games",
    "mobile game developer",
    "match 3",
    "Pakistan game studio",
    "GlitchTech",
  ],
  authors: [{ name: STUDIO.name }],
  openGraph: {
    type: "website",
    url: SITE,
    siteName: STUDIO.name,
    title: "GlitchTech Games — hybrid-casual & puzzle game studio",
    description:
      "12 titles shipped. 220K+ installs. 400+ original characters. Play our match-3 boss fight right on the page.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "GlitchTech Games — 12 titles shipped, 220K+ installs, 400+ original characters",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "GlitchTech Games",
    description:
      "Hybrid-casual and puzzle games, made in house and shipped fast.",
    images: ["/og.png"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#06060a",
  colorScheme: "dark",
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE}#org`,
      name: STUDIO.name,
      url: SITE,
      description: STUDIO.mission,
      address: { "@type": "PostalAddress", addressCountry: "PK" },
      email: STUDIO.emails.partner,
      sameAs: [STUDIO.stores.play, STUDIO.stores.apple],
    },
    ...GAMES.map((g) => ({
      "@type": "VideoGame",
      name: g.title,
      description: g.tagline,
      genre: g.genre,
      gamePlatform: ["Android", "iOS"],
      operatingSystem: g.ios ? "Android, iOS" : "Android",
      applicationCategory: "GameApplication",
      publisher: { "@id": `${SITE}#org` },
      url: g.play ?? g.ios,
      image: `${SITE}/games/${g.slug}.webp`,
      ...(g.rating
        ? {
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: g.rating,
              bestRating: 5,
              ratingCount: 50,
            },
          }
        : {}),
    })),
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${anton.variable} ${archivo.variable} ${mono.variable}`}>
      <body className="antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-cyan focus:px-4 focus:py-3 focus:font-display focus:text-void"
        >
          Skip to content
        </a>
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </body>
    </html>
  );
}
