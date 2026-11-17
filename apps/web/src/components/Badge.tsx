import type { ReactNode } from "react";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger";

export interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
}

export function Badge({ children, variant = "neutral" }: BadgeProps) {
  return <span className={`dm-badge dm-badge--${variant}`}>{children}</span>;
}
