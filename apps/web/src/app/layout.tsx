import type { ReactNode } from "react";
import { t } from "@/i18n/en";
import { EmailVerificationBanner } from "@/components/seller/EmailVerificationBanner";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

export const metadata = { title: t("app.name") };
export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg text-text antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:p-3">
          {t("nav.skip")}
        </a>
        <ToastProvider>
          <SiteHeader />
          <EmailVerificationBanner />
          <div id="main" tabIndex={-1} className="min-h-[60vh]">{children}</div>
          <SiteFooter />
        </ToastProvider>
      </body>
    </html>
  );
}
