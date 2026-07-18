import type { Metadata } from "next";
import { Cinzel, Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import TopoBackground from "./TopoBackground";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

// Engraved-capitals display face for wordmarks, screen titles, and
// campaign names; body text stays on Geist/Source Serif.
const cinzel = Cinzel({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "Open Dungeon Master",
  description: "Multiplayer D&D 5e campaigns with an AI Dungeon Master.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable} ${cinzel.variable} h-full antialiased`}
      // browser extensions inject attributes into <html> before React loads
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <TopoBackground />
        {children}
      </body>
    </html>
  );
}
