import type { ReactNode } from "react";
import { Button } from "./Button";

export type NoticeTone = "neutral" | "success" | "warning" | "danger";

export interface NoticeProps {
  children: ReactNode;
  actionLabel: string;
  onAction: () => void;
  tone?: NoticeTone;
}

export function Notice({
  children,
  actionLabel,
  onAction,
  tone = "neutral",
}: NoticeProps) {
  const toneClass = tone === "neutral" ? "" : ` dm-notice-primitive--${tone}`;

  return (
    <div className={`dm-notice-primitive${toneClass}`} role="status">
      <div>{children}</div>
      <Button variant="text" onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}
