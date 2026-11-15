import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";

// next/font downloads the files at build time and serves them from our own
// origin, so players never wait on fonts.googleapis.com.
const cairo = Cairo({
  subsets: ["arabic", "latin"],
  display: "swap",
  variable: "--font-cairo",
});

export const metadata: Metadata = {
  title: "بلادي گيسر — شحال كتعرف المغرب؟",
  description:
    "لعبة مغربية: طيح فوسط شارع مغربي حقيقي، دور، مشي، وحط الدبوس فين كتضن بلاصتك. من شفشاون للداخلة.",
};

export const viewport: Viewport = {
  themeColor: "#0b0f0e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} h-full`}>
      <head>
        {/* Warm the connections before the first round asks for imagery. */}
        <link rel="preconnect" href="https://graph.mapillary.com" crossOrigin="" />
        <link rel="preconnect" href="https://basemaps.cartocdn.com" crossOrigin="" />
        <link rel="dns-prefetch" href="https://tile.openstreetmap.org" />
      </head>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
