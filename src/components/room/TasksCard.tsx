"use client";

import { Check } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Corners } from "@/components/ui/Corners";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/cn";
import { loadStored, saveStored } from "@/lib/storage";

interface Task {
  text: string;
  done: boolean;
}

const MAX_TASK_LENGTH = 120;

/**
 * Your checklist for this room. The list itself stays on this device; the first open
 * item is shared with the room as what you're working on (the "Working on" line others see).
 */
export function TasksCard({
  roomId,
  sharedTask,
  onSharedTaskChange,
}: {
  roomId: string;
  sharedTask: string;
  onSharedTaskChange: (task: string) => void;
}) {
  const storageKey = `tasks.${roomId}`;
  const initialSharedTask = useRef(sharedTask);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const stored = loadStored<Task[]>(storageKey, []);
    // First time in this room on this device: start from what the room already shows for you.
    setTasks(stored.length === 0 && initialSharedTask.current ? [{ text: initialSharedTask.current, done: false }] : stored);
  }, [storageKey]);

  function update(next: Task[]) {
    setTasks(next);
    saveStored(storageKey, next);
    const firstOpen = next.find((task) => !task.done)?.text ?? "";
    if (firstOpen !== sharedTask) onSharedTaskChange(firstOpen);
  }

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    update([...tasks, { text, done: false }]);
  }

  const doneCount = tasks.filter((task) => task.done).length;

  return (
    <div className="card blueprint side-card">
      <Corners />
      <div className="row-between">
        <span className="card-title">Your tasks this session</span>
        <span className="side-count">
          {doneCount} of {tasks.length} done
        </span>
      </div>
      {tasks.length > 0 && (
        <div className="task-list">
          {tasks.map((task, i) => (
            <button
              key={i}
              className={cn("task", task.done && "is-done")}
              type="button"
              role="checkbox"
              aria-checked={task.done}
              onClick={() => update(tasks.map((t, j) => (j === i ? { ...t, done: !t.done } : t)))}
            >
              <span className="task-box">{task.done && <Icon icon={Check} size={12} className="icon-bold" />}</span>
              <span className="task-text">{task.text}</span>
            </button>
          ))}
        </div>
      )}
      <form onSubmit={handleAdd}>
        <label className="sr-only" htmlFor="new-task">
          New task
        </label>
        <input
          className="input"
          id="new-task"
          placeholder="Add a task, press Enter"
          autoComplete="off"
          maxLength={MAX_TASK_LENGTH}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </form>
      {doneCount > 0 && (
        <button
          className="btn btn-ghost side-link"
          type="button"
          onClick={() => update(tasks.filter((task) => !task.done))}
        >
          Clear done
        </button>
      )}
    </div>
  );
}
