import {
  ArrowUpRight,
  Check,
  ChevronRight,
  LoaderCircle,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

export const number = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(
        value,
      );
export const shortNumber = (value: number) =>
  value >= 1e6
    ? `${number(value / 1e6, 2)}M`
    : value >= 1e3
      ? `${number(value / 1e3, 1)}K`
      : number(value, 0);
export const date = (value: number | null | undefined, time = false) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
      })
    : "未记录";
export const mask = (value: string, privacy: boolean) =>
  privacy ? `${value.slice(0, 2)}••••${value.slice(-2)}` : value;

export function Button({
  children,
  icon: Icon,
  busy,
  primary = false,
  danger = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  busy?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`button ${primary ? "primary" : ""} ${danger ? "danger" : ""} ${props.className || ""}`}
    >
      {busy ? (
        <LoaderCircle size={15} className="spin" />
      ) : (
        Icon && <Icon size={15} />
      )}
      <span>{children}</span>
    </button>
  );
}
export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="setting-row">
      <div>
        <div className="setting-label">{label}</div>
        <div className="setting-description">{description}</div>
      </div>
      <button
        type="button"
        className={`toggle ${checked ? "checked" : ""}`}
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}
export function Empty({
  icon: Icon,
  title,
  detail,
  action,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={28} strokeWidth={1.5} />
      </span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      if (prior?.isConnected) prior.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
          if (e.key !== "Tab") return;
          const items = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
            ) ?? [],
          ).filter((item) => item.getClientRects().length > 0);
          const first = items[0],
            last = items[items.length - 1];
          if (!first) {
            e.preventDefault();
            return;
          }
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-content">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </section>
    </div>
  );
}
export function Metric({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  icon: LucideIcon;
}) {
  return (
    <div className="metric">
      <div className="metric-label">
        {label}
        <Icon size={17} strokeWidth={1.5} />
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-detail">{detail}</div>
    </div>
  );
}
export function SectionHeader({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {detail && <p>{detail}</p>}
      </div>
      {children}
    </div>
  );
}
export function Status({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={`status ${ok ? "good" : "warn"}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}
export function TextLink({
  children,
  onClick,
  arrow = false,
}: {
  children: ReactNode;
  onClick: () => void;
  arrow?: boolean;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      {arrow ? <ArrowUpRight size={14} /> : <ChevronRight size={14} />}
    </button>
  );
}
export function CheckIcon() {
  return <Check size={14} />;
}
