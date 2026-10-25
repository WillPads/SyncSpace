"use client";

import { FileText, Upload } from "lucide-react";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Corners } from "@/components/ui/Corners";
import { Icon } from "@/components/ui/Icon";
import { api, errorMessage, isProcessing } from "@/lib/api";
import type { DocumentStatus, RoomDocument } from "@/lib/types";

const STATUS: Record<DocumentStatus, { label: string; tagClass: string }> = {
  PENDING: { label: "Processing", tagClass: "tag tag-neutral" },
  PARSING: { label: "Processing", tagClass: "tag tag-neutral" },
  READY: { label: "Ready", tagClass: "tag tag-accent" },
  FAILED: { label: "Failed", tagClass: "tag tag-outline" },
};

/** Notes uploaded here are parsed on the server and turned into the end-of-session quiz. */
export function NotesCard({ roomId, quizVersion }: { roomId: string; quizVersion: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { data: documents, mutate } = useSWR<RoomDocument[]>(["documents", roomId], () => api.listDocuments(roomId), {
    // Poll only while something is still being parsed. A document too short to make a
    // quiz never sends quiz:ready, so the socket alone can't be relied on here.
    refreshInterval: (latest) => (latest?.some((doc) => isProcessing(doc.status)) ? 2000 : 0),
  });

  useEffect(() => {
    if (quizVersion > 0) void mutate();
  }, [quizVersion, mutate]);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      await api.uploadDocument(roomId, file);
      await mutate();
    } catch (err) {
      setUploadError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="card blueprint side-card">
      <Corners />
      <div className="row-between">
        <span className="card-title">Session notes</span>
        <span className="side-count">{documents?.length ?? 0} files</span>
      </div>
      <p className="side-note">Upload .txt, .md or .pdf notes. Everyone gets a quiz built from them when the session ends.</p>
      {documents && documents.length > 0 && (
        <ul className="doc-list">
          {documents.map((doc) => (
            <li className="doc-row" key={doc.id}>
              <Icon icon={FileText} size={15} />
              <span className="ellipsis">{doc.filename}</span>
              <span className={STATUS[doc.status].tagClass}>{STATUS[doc.status].label}</span>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
        tabIndex={-1}
        aria-hidden
        onChange={handleFile}
      />
      <button
        className="btn btn-secondary w-full"
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
      >
        <Icon icon={Upload} />
        {uploading ? "Uploading…" : "Upload notes"}
      </button>
      {uploadError && (
        <p className="form-err" role="alert">
          {uploadError}
        </p>
      )}
    </div>
  );
}
