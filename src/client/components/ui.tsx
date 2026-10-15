import { useEffect, useState, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from 'react';

type Variant = 'primary' | 'accent' | 'ghost' | 'danger' | 'outline';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:brightness-110 glow',
  accent: 'bg-accent text-on-accent hover:brightness-110',
  ghost: 'bg-transparent text-fg hover:bg-raised',
  danger: 'bg-danger/15 text-danger ring-1 ring-danger/40 hover:bg-danger/25',
  outline: 'bg-surface text-fg ring-1 ring-line hover:bg-raised',
};

export function Button({
  variant = 'primary',
  size = 'md',
  busy,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; busy?: boolean }) {
  const sizes = { sm: 'h-8 px-3 text-sm', md: 'h-11 px-4', lg: 'h-14 px-6 text-lg' };
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {busy ? <Spinner small /> : null}
      {children}
    </button>
  );
}

export function Card({
  children,
  className = '',
  title,
  actions,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className={`rounded-[var(--radius-theme)] bg-surface p-4 ring-1 ring-line/70 sm:p-5 ${className}`}>
      {title || actions ? (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="text-lg font-semibold">{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-muted">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  'h-11 w-full rounded-xl bg-bg px-3 text-fg ring-1 ring-line placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-accent';

export function Input(props: ComponentProps<'input'>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Select({ children, ...props }: ComponentProps<'select'>) {
  return (
    <select {...props} className={`${inputClass} ${props.className ?? ''}`}>
      {children}
    </select>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent' | 'primary';
}) {
  const tones = {
    neutral: 'bg-raised text-muted',
    success: 'bg-success/15 text-success',
    warning: 'bg-warning/15 text-warning',
    danger: 'bg-danger/15 text-danger',
    accent: 'bg-accent/15 text-accent',
    primary: 'bg-primary/15 text-primary',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${small ? 'h-4 w-4' : 'h-8 w-8'}`}
    />
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'primary' | 'accent';
}) {
  const color = tone === 'primary' ? 'text-primary' : tone === 'accent' ? 'text-accent' : 'text-fg';
  return (
    <div className="rounded-2xl bg-raised/60 p-4 ring-1 ring-line/60">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 font-display text-3xl font-bold tabular-nums ${color}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

export function Notice({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  children: ReactNode;
}) {
  const tones = {
    neutral: 'bg-raised text-fg ring-line',
    success: 'bg-success/10 text-success ring-success/30',
    warning: 'bg-warning/10 text-warning ring-warning/30',
    danger: 'bg-danger/10 text-danger ring-danger/30',
  };
  return <div className={`rounded-xl px-4 py-3 text-sm ring-1 ${tones[tone]}`}>{children}</div>;
}

export function Toast({
  message,
  tone = 'success',
  onDone,
}: {
  message: string | null;
  tone?: 'success' | 'danger';
  onDone: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(onDone, 3200);
    return () => window.clearTimeout(id);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4" role="status">
      <div
        className={`animate-pop rounded-2xl px-5 py-3 font-semibold shadow-2xl ${tone === 'success' ? 'bg-success text-bg' : 'bg-danger text-bg'}`}
      >
        {message}
      </div>
    </div>
  );
}

export function useToast() {
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'danger' } | null>(null);
  return {
    show: (message: string, tone: 'success' | 'danger' = 'success') => setToast({ message, tone }),
    element: <Toast message={toast?.message ?? null} tone={toast?.tone} onDone={() => setToast(null)} />,
  };
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-muted">{children}</div>
  );
}
