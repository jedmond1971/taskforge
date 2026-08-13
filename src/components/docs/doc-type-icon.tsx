import { FileText } from "lucide-react";
import { FileIcon, defaultStyles } from "react-file-icon";

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOC_MIME = "application/msword";

interface DocTypeIconProps {
  type: string;
  mimeType?: string | null;
  size: number;
}

export function DocTypeIcon({ type, mimeType, size }: DocTypeIconProps) {
  if (type !== "DOCUMENT") {
    return (
      <FileText
        className="text-zinc-400 flex-shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }

  let fileIcon;
  if (mimeType === PDF_MIME) {
    fileIcon = <FileIcon extension="pdf" {...defaultStyles.pdf} />;
  } else if (mimeType === DOCX_MIME) {
    fileIcon = <FileIcon extension="docx" {...defaultStyles.docx} />;
  } else if (mimeType === DOC_MIME) {
    fileIcon = <FileIcon extension="doc" {...defaultStyles.doc} />;
  } else {
    fileIcon = <FileIcon type="document" />;
  }

  return (
    <div className="flex-shrink-0" style={{ width: size, height: size }}>
      {fileIcon}
    </div>
  );
}
