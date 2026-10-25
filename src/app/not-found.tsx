import Link from "next/link";
import { ScreenMessage } from "@/components/ui/ScreenMessage";

export default function NotFound() {
  return (
    <ScreenMessage title="Page not found" body="That address doesn't match anything in SyncSpace.">
      <Link className="btn btn-secondary" href="/">
        Back to home
      </Link>
    </ScreenMessage>
  );
}
