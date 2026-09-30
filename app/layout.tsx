import type { Metadata } from "next";
import {
  Allura,
  Cormorant_Garamond,
  Inter,
  Playfair_Display,
} from "next/font/google";
import "./globals.css";

const playfair = Playfair_Display({
  weight: ["800"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-playfair",
});

const cormorant = Cormorant_Garamond({
  weight: ["600", "700"],
  style: ["normal", "italic"],
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
  title: "Set for Life — Financial Assessment",
  description:
    "A guided financial assessment to help you build a life of clarity, confidence, and lasting security.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${playfair.variable} ${cormorant.variable} ${inter.variable} ${allura.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
