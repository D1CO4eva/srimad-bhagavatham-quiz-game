import type { Metadata } from "next";
import { Cormorant_Garamond, Source_Sans_3 } from "next/font/google";
import Image from "next/image";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Bhagavatam Quiz Live",
  description: "A live, Kahoot-style quiz for the Bhagavatam self-study program.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${cormorant.variable} ${sourceSans.variable} h-full antialiased`}>
      <body className="relative min-h-full flex flex-col">
        <Image
          src="/god-logo.jpg"
          alt="Global Organization for Divinity"
          width={1024}
          height={617}
          priority
          className="absolute right-4 top-4 z-50 h-10 w-auto rounded-md shadow-md sm:h-12"
        />
        {children}
      </body>
    </html>
  );
}
