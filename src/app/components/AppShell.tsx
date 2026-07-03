"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import CursorTrail from "./CursorTrail";
import TopNav from "./TopNav";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isStandalonePage =
    pathname.startsWith("/ops/") ||
    pathname === "/ops" ||
    pathname === "/countdown/download";

  return (
    <>
      {!isStandalonePage && <CursorTrail />}
      {!isStandalonePage && <TopNav />}
      <main className={isStandalonePage ? "opsMain" : "appMain"}>{children}</main>
    </>
  );
}
