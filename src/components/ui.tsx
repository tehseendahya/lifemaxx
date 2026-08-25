import type { ReactNode } from "react";

export function Screen({ title, subtitle, children, action }: {
  title: string; subtitle?: ReactNode; children: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="pt-8">
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 ${className}`}>
      {children}
    </section>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
      {children}
    </div>
  );
}

/**
 * A macro ring, done as a bar. Rings look nice and read badly — a bar with the
 * target marked tells you "how far over/under" at a glance, which is the only
 * question anyone actually asks of this number.
 */
export function MacroBar({ label, value, target, unit = "g", tone = "accent" }: {
  label: string; value: number; target?: number | null; unit?: string;
  tone?: "accent" | "good" | "warn";
}) {
  const pct = target && target > 0 ? Math.min(150, (value / target) * 100) : 0;
  const over = target ? value > target * 1.05 : false;
  const colour = over ? "bg-warn" : tone === "good" ? "bg-good" : "bg-accent";

  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="tnum font-medium">
          {Math.round(value)}{unit}
          {target ? <span className="text-muted"> / {Math.round(target)}{unit}</span> : null}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${colour}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
    </div>
  );
}

export function Button({ children, onClick, variant = "primary", type = "button", disabled, className = "" }: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  const styles = {
    primary: "bg-accent text-ground font-semibold",
    secondary: "border border-line-strong bg-surface-2 text-ink",
    ghost: "text-muted",
    danger: "border border-line-strong text-bad",
  }[variant];

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-4 py-2.5 text-sm transition-opacity active:opacity-70 disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="tnum mt-0.5 text-xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}
