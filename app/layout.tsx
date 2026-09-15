import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "My Bottle Shelf",
  description: "お気に入りのお酒を記録する、私だけのデジタル酒棚。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
