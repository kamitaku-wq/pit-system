import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "整備ピット予約システム",
  description: "中古車販売会社向け 整備ピット予約・店間整備・業者通知システム",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
