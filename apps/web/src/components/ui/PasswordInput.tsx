import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "../../lib/cn.js";

// A password field with a show/hide toggle — same visual shell as Input,
// but never exposed there since a right-side icon slot only ever makes
// sense for this one field type.
export function PasswordInput({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        className={cn(
          "w-full rounded-xl border border-border-strong bg-surface-raised py-2.5 pl-3 pr-10 text-sm text-text placeholder:text-text-faint transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30",
          className,
        )}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        // Not a form submit action and not part of tab order — the next
        // stop from this field should be the rest of the form.
        tabIndex={-1}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-text-faint transition-colors hover:text-text"
      >
        {visible ? <EyeOff size={16} strokeWidth={2} /> : <Eye size={16} strokeWidth={2} />}
      </button>
    </div>
  );
}
