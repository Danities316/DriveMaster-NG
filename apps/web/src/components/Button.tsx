import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "text";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({
  variant = "primary",
  className = "",
  style,
  type = "button",
  ...props
}: ButtonProps) {
  const classes = ["dm-button", `dm-button--${variant}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...props}
      type={type}
      className={classes}
      style={{ ...style, minHeight: 48 }}
    />
  );
}
