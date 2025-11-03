import type { Metadata } from "next";
import "./globals.css";

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
        {children}
      </body>
    </html>
  );
}
