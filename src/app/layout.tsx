import type { Metadata } from "next";
import "./globals.css";
import Providers from "./components/Providers";
import AppShell from "./components/AppShell";

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
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
