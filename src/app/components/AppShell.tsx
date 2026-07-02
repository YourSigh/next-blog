"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import CursorTrail from "./CursorTrail";
import TopNav from "./TopNav";

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isOpsPage = pathname.startsWith("/ops/") || pathname === "/ops";

  return (
    <>
      {!isOpsPage && <CursorTrail />}
      {!isOpsPage && <TopNav />}
      <main className={isOpsPage ? "opsMain" : "appMain"}>{children}</main>
    </>
  );
}
