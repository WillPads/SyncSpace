"use client";

import { Check, Pencil } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

export function CurrentTaskCard({
  task,
  onSave,
}: {
  task: string;
  onSave: (task: string) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(task);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isEditing) setValue(task);
  }, [task, isEditing]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || isSaving) return;
    setIsSaving(true);
    try {
      await onSave(trimmed);
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card className="flex items-center gap-4 p-5">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted">Working on</span>
      {isEditing ? (
        <form onSubmit={handleSubmit} className="flex flex-1 items-center gap-2">
          <Input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            maxLength={120}
            placeholder="What are you working on?"
            className="py-2"
          />
          <Button type="submit" size="sm" isLoading={isSaving}>
            <Check className="h-4 w-4" />
          </Button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="group flex flex-1 items-center justify-between gap-2 truncate text-left text-sm text-foreground"
        >
          <span className="truncate">{task || "Click to set a focus for this session"}</span>
          <Pencil className="h-3.5 w-3.5 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
        </button>
      )}
    </Card>
  );
}
