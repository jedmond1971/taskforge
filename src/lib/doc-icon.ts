import { FileText, FileArchive, type LucideIcon } from "lucide-react";

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface DocIcon {
  Icon: LucideIcon;
  className: string;
}

export function getDocIcon(type: string, mimeType?: string | null): DocIcon {
  if (type !== "DOCUMENT") {
    return { Icon: FileText, className: "text-zinc-400" };
  }
  if (mimeType === PDF_MIME) {
    return { Icon: FileArchive, className: "text-red-500 dark:text-red-400" };
  }
  if (mimeType === DOCX_MIME) {
    return { Icon: FileArchive, className: "text-blue-500 dark:text-blue-400" };
  }
  return { Icon: FileArchive, className: "text-zinc-400" };
}
