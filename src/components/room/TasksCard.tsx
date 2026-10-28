"use client";

import { Check } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
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
    <section className="tile rm-card" aria-labelledby="rm-tasks-h">
      <header className="rm-card-head">
        <h2 id="rm-tasks-h">Your tasks this session</h2>
        <span className="rm-count">
          {doneCount} of {tasks.length} done
        </span>
      </header>
      {tasks.length > 0 && (
        <div className="rm-task-list">
          {tasks.map((task, i) => (
            <button
              key={i}
              className={cn("rm-task", task.done && "is-done")}
              type="button"
              role="checkbox"
              aria-checked={task.done}
              onClick={() => update(tasks.map((t, j) => (j === i ? { ...t, done: !t.done } : t)))}
            >
              <span className="rm-task-box">{task.done && <Icon icon={Check} size={12} className="icon-bold" />}</span>
              <span className="rm-task-text">{task.text}</span>
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
      <p className="help">The first task you have not finished is shown to the room as what you are working on.</p>
      {doneCount > 0 && (
        <button
          className="link-btn rm-clear"
          type="button"
          onClick={() => update(tasks.filter((task) => !task.done))}
        >
          Clear done
        </button>
      )}
    </section>
  );
}
