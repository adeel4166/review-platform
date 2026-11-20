import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Review Platform" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg text-text">{children}</body>
    </html>
  );
}
