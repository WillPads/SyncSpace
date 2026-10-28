"use client";

import { ArrowRight, FileText, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { Icon } from "@/components/ui/Icon";
import { useNow } from "@/hooks/useNow";
import type { MyDocuments } from "@/hooks/useMyDocuments";
import { type DashboardFile, friendlyError, isProcessing } from "@/lib/api";
import { formatSize, timeAgo } from "@/lib/dashboardFormat";

/** "Recent files": your latest uploads across all rooms, with their quiz status. */
export function RecentFilesTile({ documents }: { documents: MyDocuments }) {
  const { files, error, isLoading, remove, retry } = documents;
  const now = useNow(30_000);
  const [message, setMessage] = useState<string | null>(null);

  async function handleDelete(file: DashboardFile) {
    setMessage(null);
    try {
      await remove(file);
    } catch (err) {
      setMessage(friendlyError(err));
    }
  }

  return (
    <section className="tile dash-files" aria-labelledby="files-h">
      <div className="tile-head">
        <h2 id="files-h">Recent files</h2>
      </div>
      <p className="help">Quiz questions are made from your files. The quiz runs in the room when the host ends the session.</p>
      {message && (
        <p className="form-err" role="alert">
          {message}
        </p>
      )}
      {error && !files ? (
        <div className="empty" role="alert">
          <p>{friendlyError(error)}</p>
          <button className="btn btn-secondary" type="button" onClick={() => void retry()}>
            Try again
          </button>
        </div>
      ) : isLoading ? (
        <p className="rooms-loading" role="status">
          <Icon icon={LoaderCircle} size={18} className="spin" />
          Loading your files…
        </p>
      ) : files && files.length === 0 ? (
        <div className="empty">
          <p>No files yet. Upload notes or slides and SyncSpace will turn them into quiz questions.</p>
        </div>
      ) : (
        <ul className="rows">
          {files?.map((file) => (
            <FileRow key={file.id} file={file} now={now} onDelete={handleDelete} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FileRow({
  file,
  now,
  onDelete,
}: {
  file: DashboardFile;
  now: number;
  onDelete: (file: DashboardFile) => void;
}) {
  const details = [file.roomName, formatSize(file.sizeBytes), timeAgo(file.createdAt, now)].filter(Boolean).join(" · ");

  return (
    <li className="row">
      <span className="row-icon">
        <Icon icon={FileText} size={20} />
      </span>
      <div className="row-info">
        <span className="row-title" title={file.filename}>
          {file.filename}
        </span>
        <span className="row-sub">{details}</span>
        {file.status === "FAILED" && (
          <span className="row-sub row-warn">{file.failureReason ?? "We couldn't read this file."}</span>
        )}
      </div>
      <div className="row-actions">
        {isProcessing(file.status) ? (
          <span className="chip" role="status">
            <Icon icon={LoaderCircle} size={14} className="spin" />
            {file.status === "PENDING" ? "Waiting…" : "Reading…"}
          </span>
        ) : file.status === "READY" ? (
          <>
            <span className="chip chip-ok">
              {file.questionCount === null ? "Ready" : `${file.questionCount} ${file.questionCount === 1 ? "question" : "questions"}`}
            </span>
            <Link className="btn btn-secondary" href={`/room/${file.roomId}`}>
              Open in room
              <Icon icon={ArrowRight} size={14} />
            </Link>
          </>
        ) : (
          <span className="chip">Failed</span>
        )}
        {/* canDelete comes from the server and follows the same rule as the delete route: you uploaded it, or you host the room. */}
        {file.canDelete && (
          <ConfirmButton
            className="btn btn-secondary"
            confirmLabel="Confirm delete"
            label={`Delete ${file.filename}`}
            onConfirm={() => onDelete(file)}
          >
            Delete
          </ConfirmButton>
        )}
      </div>
    </li>
  );
}
