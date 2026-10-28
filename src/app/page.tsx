import { CodeJoinForm } from "@/components/CodeJoinForm";
import { OverviewNav, OpenRoomButton } from "@/components/overview/OverviewActions";
import { PreviewCard } from "@/components/overview/PreviewCard";
import { AppBackdrop } from "@/components/ui/Backdrop";

const STEPS = [
  {
    n: "01",
    title: "Open a room",
    body: "Pick focus and break lengths, then share the room code or invite link with your group.",
  },
  {
    n: "02",
    title: "One clock for everyone",
    body: "The host starts the timer and every screen in the room counts down together.",
  },
  {
    n: "03",
    title: "Quiz on what you studied",
    body: "Drop your notes into the room. When the host ends the session, everyone gets a quiz built from them.",
  },
];

export default function OverviewPage() {
  return (
    <div className="redesign app-screen">
      <AppBackdrop />
      <OverviewNav />
      <main className="ovw">
        <section className="tile tile-tint ovw-hero" aria-labelledby="ovw-h">
          <p className="eyebrow">Co-working rooms · shared Pomodoro clock</p>
          <h1 id="ovw-h">Work alongside people. On the same clock.</h1>
          <p className="ovw-lede">
            SyncSpace rooms run one Pomodoro timer for everyone inside. Focus together, take the break together, then
            test yourself on what you covered.
          </p>
          <div className="ovw-actions">
            <OpenRoomButton />
            <CodeJoinForm id="ov-code" />
          </div>
        </section>
        <PreviewCard />
        <ol className="ovw-steps" id="how" aria-label="How it works">
          {STEPS.map((step) => (
            <li className="tile" key={step.n}>
              <span className="ovw-step-n">{step.n}</span>
              <h2>{step.title}</h2>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
