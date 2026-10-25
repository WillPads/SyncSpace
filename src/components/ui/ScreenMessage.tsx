import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Corners } from "@/components/ui/Corners";
import { Icon } from "@/components/ui/Icon";

/** A centered status card for loading, empty and error screens. */
export function ScreenMessage({
  title,
  body,
  loading = false,
  children,
}: {
  title: string;
  body?: ReactNode;
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="screen-center">
      <div className="notice-card blueprint" role={loading ? "status" : undefined}>
        <Corners />
        {loading && <Icon icon={LoaderCircle} size={22} className="spin" />}
        <h3>{title}</h3>
        {body && <p className="muted">{body}</p>}
        {children && <div className="notice-actions">{children}</div>}
      </div>
    </div>
  );
}
