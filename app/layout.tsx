import type { Metadata } from "next";
import {
  Allura,
  Cormorant_Garamond,
  Inter,
  Playfair_Display,
} from "next/font/google";
import { BRAND_NAME } from "@/lib/brand";
import "./globals.css";

const playfair = Playfair_Display({
  weight: ["800"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-playfair",
});

// Font Map v1, verbatim: "Cormorant 600 normal/italic and 700 normal".
//
// `next/font` loads the CROSS-PRODUCT of `weight` and `style`, so listing
// both styles here would also fetch Cormorant 700 ITALIC — a face the locked
// type system never specifies. No token uses it: T05 is 600 italic, and every
// 700 token (T10, T11, T13, T18, T20) is upright. Declaring the weights
// separately loads exactly the specified faces and nothing else.
const cormorantItalic = Cormorant_Garamond({
  weight: ["600"],
  style: ["italic"],
  subsets: ["latin"],
  variable: "--font-cormorant-italic",
});

const cormorant = Cormorant_Garamond({
  weight: ["600", "700"],
  style: ["normal"],
  subsets: ["latin"],
  variable: "--font-cormorant",
});

const inter = Inter({
  weight: ["400", "600", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-inter",
});

const allura = Allura({
  weight: ["400"],
  subsets: ["latin"],
  variable: "--font-allura",
});

export const metadata: Metadata = {
  title: `${BRAND_NAME} — Financial Assessment`,
  description:
    "A guided financial self-assessment designed to help you see your financial picture more clearly and understand what deserves your attention next.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${cormorant.variable} ${cormorantItalic.variable} ${inter.variable} ${allura.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
