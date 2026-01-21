import type { Metadata } from "next";
import "./globals.css";
import TopNav from "./components/TopNav";
import CursorTrail from "./components/CursorTrail";

export const metadata: Metadata = {
  title: "绿桶的小世界",
  description: "Welcome to the world of Green Bucket",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <CursorTrail />
        <TopNav />
        <main className="appMain">{children}</main>
      </body>
    </html>
  );
}
