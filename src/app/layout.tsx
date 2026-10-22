import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Humanly — Paraphraser & AI Humanizer",
  description: "Rewrite stiff, robotic text into clear, natural writing. Ten modes, synonym control, frozen words and sentence-level alternatives.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
