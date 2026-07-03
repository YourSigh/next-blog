import type { Metadata } from "next";
import DownloadPortal from "./DownloadPortal";

export const metadata: Metadata = {
  title: "Countdown 下载",
  description: "Countdown Android 安装包下载",
  robots: { index: false, follow: false },
};

export default function CountdownDownloadPage() {
  return <DownloadPortal />;
}
