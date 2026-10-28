import Link from "next/link";
import { AppBackdrop } from "@/components/ui/Backdrop";
import { BrandMark } from "@/components/ui/Brand";
import { ScreenMessage } from "@/components/ui/ScreenMessage";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export default function NotFound() {
  return (
    // Same shell as /signed-out (styles in screens/login.css), so the 404 card gets the redesigned look.
    <div className="redesign app-screen auth-screen">
      <AppBackdrop />
      <header className="auth-bar">
        <Link href="/" className="brand-btn">
          <BrandMark />
          SyncSpace
        </Link>
        <ThemeToggle />
      </header>
      <ScreenMessage title="Page not found" body="That address doesn't match anything in SyncSpace.">
        <Link className="btn btn-secondary" href="/">
          Back to home
        </Link>
      </ScreenMessage>
    </div>
  );
}
