import type { Metadata } from "next";
import AttachmentPortal from "./AttachmentPortal";

export const metadata: Metadata = {
  title: "附件中心",
  description: "上传、预览和下载附件",
  robots: { index: false, follow: false },
};

export default function AttachmentsPage() {
  return <AttachmentPortal />;
}
