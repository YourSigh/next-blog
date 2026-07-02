import type { Metadata } from "next";
import OpsConsole from "./OpsConsole";

export const metadata: Metadata = {
  title: "Countdown 发布控制台",
  robots: { index: false, follow: false },
};

export default function CountdownOpsPage() {
  return <OpsConsole />;
}
