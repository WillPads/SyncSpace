import { Timer, Users, Volume2, type LucideIcon } from "lucide-react";
import { CreateRoomPanel } from "@/components/landing/CreateRoomPanel";
import { JoinRoomPanel } from "@/components/landing/JoinRoomPanel";
import { Logo } from "@/components/ui/Logo";

export default function Home() {
  return (
    <div className="relative overflow-hidden">
      <BackgroundGlow />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <a href="#join" className="text-sm text-muted transition-colors hover:text-foreground">
          Have a room code?
        </a>
      </header>

      <main className="relative mx-auto flex max-w-6xl flex-col gap-24 px-6 pb-24 pt-8 sm:pt-16">
        <section className="flex flex-col items-center gap-6 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface px-4 py-1.5 text-xs font-medium text-muted">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-primary" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
            Synchronized focus rooms
          </span>

          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-6xl">
            Focus together, <span className="text-primary">in real time.</span>
          </h1>

          <p className="max-w-xl text-balance text-base text-muted sm:text-lg">
            SyncSpace is a shared Pomodoro room for study groups and remote teams. One timer, one
            rhythm — start a session and the whole room focuses with you.
          </p>
        </section>

        <section id="join" className="mx-auto grid w-full max-w-4xl gap-6 sm:grid-cols-2">
          <CreateRoomPanel />
          <JoinRoomPanel />
        </section>

        <section className="grid gap-6 sm:grid-cols-3">
          <FeatureCard
            icon={Timer}
            title="Shared Pomodoro timer"
            description="One clock for the whole room. Start, pause, and skip stay in lockstep for everyone inside."
          />
          <FeatureCard
            icon={Users}
            title="Live participant roster"
            description="See who's here, what they're working on, and whether they're heads-down or on a break."
          />
          <FeatureCard
            icon={Volume2}
            title="Ambient focus sounds"
            description="Layer in rain, coffee shop murmur, or white noise — generated live, no downloads required."
          />
        </section>
      </main>

      <footer className="relative border-t border-border py-8 text-center text-xs text-muted">
        Built for focused people. No sign-up, no tracking, no external services.
      </footer>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface/60 p-6">
      <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" strokeWidth={2} />
      </span>
      <h3 className="mb-1.5 text-base font-medium text-foreground">{title}</h3>
      <p className="text-sm leading-relaxed text-muted">{description}</p>
    </div>
  );
}

function BackgroundGlow() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute left-1/2 top-[-12rem] h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-[120px]" />
      <div className="absolute right-[-8rem] top-1/3 h-[24rem] w-[24rem] rounded-full bg-red-900/20 blur-[100px]" />
    </div>
  );
}
