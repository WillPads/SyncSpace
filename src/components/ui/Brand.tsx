import { Timer } from "lucide-react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

export function BrandMark() {
  return (
    <span className="brand-mark blueprint">
      <i className="corner tl" />
      <i className="corner br" />
      <Icon icon={Timer} />
    </span>
  );
}

/** The wordmark. `hideNameOnPhones` keeps just the mark in the app nav at narrow widths. */
export function Brand({ href = "/", hideNameOnPhones = false }: { href?: string; hideNameOnPhones?: boolean }) {
  return (
    <Link href={href} className="nav-brand brand brand-link" aria-label="SyncSpace home">
      <BrandMark />
      <span className={hideNameOnPhones ? "brand-name" : undefined}>SyncSpace</span>
    </Link>
  );
}
