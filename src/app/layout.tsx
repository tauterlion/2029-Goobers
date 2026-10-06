import type { Metadata } from "next";
import "./globals.css";
import "./themes.css";
import "./qol.css";
import { COPY } from "@/game/copy";
export const metadata: Metadata = {
  title: `2029 Goobers — ${COPY.site.tagline}`,
  description: COPY.site.description,
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
