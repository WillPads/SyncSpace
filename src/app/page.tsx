import { OverviewHeroActions, OverviewNav } from "@/components/overview/OverviewActions";

// The landing page is deliberately short: who we are, what SyncSpace does, and the two ways in.
// Every sentence below describes something the app really does.
export default function OverviewPage() {
  return (
    <div className="redesign app-screen">
      <OverviewNav />
      <main className="ovw">
        <section className="tile ovw-hero" aria-labelledby="ovw-h">
          <h1 id="ovw-h">Welcome to SyncSpace</h1>
          <p className="ovw-lede">
            SyncSpace is a place to study with other people. Join a room and everyone inside shares one Pomodoro
            timer, so you focus and take breaks at the same time. Chat with the room, and when the host ends the
            session, take a short quiz built from the notes you uploaded.
          </p>
          <OverviewHeroActions />
        </section>
      </main>
    </div>
  );
}
