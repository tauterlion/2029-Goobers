import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "2029 Goobers — terrible captions. excellent company.",
  description: "A private meme-caption party for 4–12 friends.",
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
