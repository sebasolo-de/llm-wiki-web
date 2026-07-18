import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Link from 'next/link';
import "./globals.css";
import { getDesignSettings } from "@/lib/wiki";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const viewport: Viewport = {
  themeColor: "#6366f1",
};

export const metadata: Metadata = {
  title: "LLM Wiki Betreuungsrecht",
  description: "Wissensdatenbank Betreuungsrecht",
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { variables, customCss, googleFonts } = getDesignSettings();

  const cssVariablesString = Object.entries(variables)
    .map(([key, val]) => `${key}: ${val};`)
    .join('\n');

  const dynamicStyles = `
    :root {
      ${cssVariablesString}
    }
    ${customCss}
  `;

  const googleFontsUrl = googleFonts.length > 0
    ? `https://fonts.googleapis.com/css2?${googleFonts
        .map(f => `family=${f.replace(/\s+/g, '+')}:wght@300;400;500;600;700;800`)
        .join('&')}&display=swap`
    : null;

  return (
    <html lang="de" className={`${inter.variable} h-full antialiased`}>
      <head>
        {/* Preconnect for Google Fonts if needed, Inter is handled by Next.js */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {googleFontsUrl && <link rel="stylesheet" href={googleFontsUrl} />}
        {dynamicStyles && (
          <style dangerouslySetInnerHTML={{ __html: dynamicStyles }} />
        )}
      </head>
      <body className="h-full bg-primary text-primary">
        <div className="app-container">
          {/* Sticky Header */}
          <header className="site-header">
            <div className="logo-container">
              <Link href="/" className="logo-container">
                <span className="logo-text">⚖️ LLM-Wiki Betreuungsrecht</span>
              </Link>
            </div>
            
            <nav className="header-nav">
              <Link href="/" className="nav-link">
                Home
              </Link>
              <Link href="/gesetze/BGB/BGB" className="nav-link">
                BGB Systematik
              </Link>
              <Link href="/meta/Quellenregister" className="nav-link">
                Quellen
              </Link>
            </nav>
          </header>

          {/* Page Content */}
          {children}
        </div>
      </body>
    </html>
  );
}
