import type { Metadata } from "next";
import "./globals.css";
import TopNav from "./components/TopNav";
import CursorTrail from "./components/CursorTrail";
import Providers from "./components/Providers";

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
        <Providers>
          <CursorTrail />
          <TopNav />
          <main className="appMain">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
