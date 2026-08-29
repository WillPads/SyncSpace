import { type InputHTMLAttributes, type LabelHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "w-full rounded-xl border border-border-strong bg-background-raised px-4 py-3 text-foreground placeholder:text-muted outline-none transition-colors",
          "focus:border-primary focus:ring-1 focus:ring-primary/40",
          className
        )}
        {...props}
      />
    );
  }
);

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(
  function Label({ className, ...props }, ref) {
    return (
      <label
        ref={ref}
        className={cn("mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted", className)}
        {...props}
      />
    );
  }
);
