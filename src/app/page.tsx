import { CodeJoinForm } from "@/components/CodeJoinForm";
import { OverviewNav, OpenRoomButton } from "@/components/overview/OverviewActions";
import { PreviewCard } from "@/components/overview/PreviewCard";

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
    <div className="ov">
      <OverviewNav />
      <div className="hero">
        <div className="hero-copy">
          <span className="card-kicker">Co-working rooms · shared Pomodoro clock</span>
          <h1>Work alongside people. On the same clock.</h1>
          <p className="hero-lede">
            SyncSpace rooms run one Pomodoro timer for everyone inside. Focus together, take the break
            together, then test yourself on what you covered.
          </p>
          <div className="hero-actions">
            <OpenRoomButton />
            <CodeJoinForm id="ov-code" />
          </div>
        </div>
        <PreviewCard />
      </div>
      <div className="steps" id="how">
        {STEPS.map((step) => (
          <div className="step" key={step.n}>
            <span className="step-n">{step.n}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
