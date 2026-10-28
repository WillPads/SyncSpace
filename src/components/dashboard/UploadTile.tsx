"use client";

import { LoaderCircle, Upload } from "lucide-react";
import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { MyDocuments } from "@/hooks/useMyDocuments";
import { api, friendlyError } from "@/lib/api";
import { UPLOAD_ACCEPT, UPLOAD_HINT, uploadProblem } from "@/lib/dashboardFormat";
import type { Room } from "@/lib/types";

/** "Upload materials": pick a room, then choose or drop PDF / TXT / MD files. */
export function UploadTile({
  rooms,
  roomsLoading,
  documents,
}: {
  rooms: Room[];
  roomsLoading: boolean;
  documents: MyDocuments;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pickedRoomId, setPickedRoomId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "Uploading notes.txt…"
  const [problems, setProblems] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Default room: the one the latest upload went to (the room you were just working in),
  // otherwise the newest room. The user's own pick wins once they change the select.
  const lastUsed = documents.files?.[0]?.roomId;
  const defaultRoomId = rooms.find((room) => room.id === lastUsed)?.id ?? rooms[0]?.id ?? "";
  const roomId = rooms.some((room) => room.id === pickedRoomId) ? (pickedRoomId as string) : defaultRoomId;
  const roomName = rooms.find((room) => room.id === roomId)?.name ?? "";
  const noRooms = !roomsLoading && rooms.length === 0;
  const disabled = !roomId || busy !== null;

  async function uploadAll(files: File[]) {
    if (files.length === 0 || disabled) return;
    const rejected: string[] = [];
    const accepted: File[] = [];
    for (const file of files) {
      const problem = uploadProblem(file);
      if (problem) rejected.push(problem);
      else accepted.push(file);
    }
    setProblems(rejected);
    setDone(null);

    let uploaded = 0;
    for (const file of accepted) {
      setBusy(`Uploading ${file.name}…`);
      try {
        await api.uploadDocument(roomId, file);
        uploaded += 1;
        void documents.refresh(); // shows the new PENDING row, which also starts the 2 s polling
      } catch (err) {
        rejected.push(`${file.name}: ${friendlyError(err)}`);
        setProblems([...rejected]);
        break; // a rate limit or an outage would fail the rest too
      }
    }
    setBusy(null);
    if (uploaded > 0) {
      setDone(
        `${uploaded === 1 ? "Uploaded 1 file" : `Uploaded ${uploaded} files`} to ${roomName}. Quiz questions appear under Recent files when it's ready.`
      );
    }
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = ""; // so choosing the same file again still fires onChange
    void uploadAll(files);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void uploadAll(Array.from(event.dataTransfer.files));
  }

  return (
    <section className="tile dash-upload" aria-labelledby="upload-h">
      <div className="tile-head">
        <h2 id="upload-h">Upload materials</h2>
      </div>
      <p className="help">{UPLOAD_HINT}</p>
      <div className="field">
        <label htmlFor="upload-room">Add to room</label>
        <select
          id="upload-room"
          className="input"
          value={roomId}
          onChange={(event) => setPickedRoomId(event.target.value)}
          disabled={rooms.length === 0 || busy !== null}
        >
          {rooms.length === 0 && <option value="">{roomsLoading ? "Loading rooms…" : "No rooms yet"}</option>}
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
      </div>
      <div
        className={dragging ? "drop is-over" : "drop"}
        role="group"
        aria-label="File upload area"
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <Icon icon={Upload} size={32} className="drop-icon" />
        <p>{noRooms ? "Join or create a room first. Files are shared with a room." : "Drag files here, or choose them from your device."}</p>
        <button className="btn btn-secondary" type="button" disabled={disabled} onClick={() => inputRef.current?.click()}>
          Choose files
        </button>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          multiple
          accept={UPLOAD_ACCEPT}
          tabIndex={-1}
          aria-label="Choose files to upload"
          onChange={handleChange}
        />
      </div>
      <div className="up-msgs">
        {busy && (
          <p className="up-busy" role="status">
            <Icon icon={LoaderCircle} size={16} className="spin" />
            {busy}
          </p>
        )}
        {!busy && done && (
          <p className="help" role="status">
            {done}
          </p>
        )}
        {problems.length > 0 && (
          <ul className="form-err" role="alert">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
