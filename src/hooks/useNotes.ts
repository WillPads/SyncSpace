"use client";

import useSWR from "swr";
import { ApiError, type NotesResponse, dashboardApi } from "@/lib/api";

const NOTES_KEY = "me/notes";

/**
 * The five-line notepad. SWR owns the list (one shared cache entry under NOTES_KEY), so the tile
 * shows cached notes instantly on a revisit and refreshes them in the background.
 */
export function useNotes() {
  const { data, error, mutate } = useSWR<NotesResponse, ApiError>(NOTES_KEY, dashboardApi.listNotes);

  /** Adds a note. Not optimistic: the server picks the id and can refuse (limit), so we wait for it. */
  async function add(text: string) {
    try {
      const note = await dashboardApi.addNote(text);
      // Put the server's answer straight into the cache instead of refetching the whole list.
      await mutate((current) => current && { ...current, notes: [note, ...current.notes] }, { revalidate: false });
    } catch (err) {
      // 409 means another tab already filled the notepad: refresh so the screen matches the server.
      if (err instanceof ApiError && err.status === 409) void mutate();
      throw err;
    }
  }

  /** Deletes a note. Optimistic: the line disappears at once and comes back if the server says no. */
  async function remove(id: string) {
    const without = (current: NotesResponse = { notes: [], limit: 5 }) => ({
      ...current,
      notes: current.notes.filter((note) => note.id !== id),
    });
    await mutate(
      async (current) => {
        try {
          await dashboardApi.deleteNote(id);
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404)) throw err; // 404: already gone, that's fine
        }
        return without(current);
      },
      { optimisticData: without, rollbackOnError: true, revalidate: false }
    );
  }

  return { notes: data?.notes, limit: data?.limit ?? 5, error, isLoading: !data && !error, add, remove, retry: () => mutate() };
}
