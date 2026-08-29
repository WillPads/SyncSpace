import Link from "next/link";
import { TimerReset } from "lucide-react";
import { cn } from "@/lib/cn";

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight", className)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/25">
        <TimerReset className="h-4 w-4" strokeWidth={2.25} />
      </span>
      <span className="text-lg text-foreground">SyncSpace</span>
    </Link>
  );
}
