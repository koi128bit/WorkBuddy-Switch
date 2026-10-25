import { useId, useState } from "react";
import { Activity } from "lucide-react";
import { number, shortNumber } from "./components";
import type { SeriesPoint } from "./analytics";

export const chartColors = [
  "var(--accent)",
  "var(--chart-blue)",
  "var(--chart-green)",
  "var(--chart-amber)",
];

export function TrendChart({
  title,
  points,
  unit = "Tokens",
  empty = false,
  emptyText = "暂无用量记录",
}: {
  title: string;
  points: SeriesPoint[];
  unit?: string;
  empty?: boolean;
  emptyText?: string;
}) {
  const id = useId().replaceAll(":", "");
  const [active, setActive] = useState<number | null>(null);
  const selected =
    points[Math.min(active ?? points.length - 1, points.length - 1)];
  const width = 640,
    height = 170,
    top = 18,
    bottom = 146;
  const max = Math.max(1, ...points.map((point) => point.value ?? 0));
  const x = (i: number) =>
    points.length <= 1
      ? width / 2
      : 14 + (i / (points.length - 1)) * (width - 28);
  const y = (value: number | null) =>
    bottom - ((value ?? 0) / max) * (bottom - top);
  // Split at unknown values so a missing measurement is never drawn as zero.
  const groups: number[][] = [];
  points.forEach((point, i) => {
    if (point.value === null) return;
    if (!i || points[i - 1].value === null) groups.push([]);
    groups.at(-1)!.push(i);
  });
  return (
    <figure className="trend-chart" aria-label={title}>
      {empty || !points.length ? (
        <div className="chart-empty">
          <Activity size={23} strokeWidth={1.4} />
          <p>{emptyText}</p>
          <small>有记录后自动显示趋势</small>
        </div>
      ) : (
        <>
          <div className="chart-readout" role="status" aria-live="polite">
            <span>{selected?.label}</span>
            <strong>
              {number(selected?.value, 2)} <small>{unit}</small>
            </strong>
            {!!selected?.unknown && (
              <small className="pending">
                {selected.unknown} 条金额或用量未知
              </small>
            )}
          </div>
          <div className="trend-plot">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                  <stop stopColor="var(--accent)" stopOpacity=".2" />
                  <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[top, (top + bottom) / 2, bottom].map((level) => (
                <line
                  key={level}
                  x1="0"
                  x2={width}
                  y1={level}
                  y2={level}
                  className="plot-grid"
                />
              ))}
              {groups.map((group) => {
                const path = group
                  .map(
                    (i, index) =>
                      `${index ? "L" : "M"}${x(i)},${y(points[i].value)}`,
                  )
                  .join(" ");
                return (
                  <g key={group[0]}>
                    <path
                      d={`${path} L${x(group.at(-1)!)},${bottom} L${x(group[0])},${bottom} Z`}
                      fill={`url(#${id})`}
                    />
                    <path d={path} className="plot-line" />
                  </g>
                );
              })}
              {selected?.value !== null && (
                <line
                  x1={x(
                    Math.min(active ?? points.length - 1, points.length - 1),
                  )}
                  x2={x(
                    Math.min(active ?? points.length - 1, points.length - 1),
                  )}
                  y1={top}
                  y2={bottom}
                  className="plot-cursor"
                />
              )}
            </svg>
            <span className="plot-max">{shortNumber(max)}</span>
            {points.map((point, i) => (
              <button
                key={point.label}
                className={`plot-point ${point === selected ? "active" : ""} ${point.value === null ? "unknown" : ""}`}
                style={{
                  left: `${(x(i) / width) * 100}%`,
                  top: `${(y(point.value) / height) * 100}%`,
                }}
                aria-label={`${point.label}：${number(point.value)} ${unit}${point.unknown ? `，${point.unknown} 条未知` : ""}`}
                onFocus={() => setActive(i)}
                onMouseEnter={() => setActive(i)}
                onClick={() => setActive(i)}
              />
            ))}
          </div>
          <div className="plot-labels">
            {points
              .filter(
                (_, i) =>
                  i === 0 ||
                  i === points.length - 1 ||
                  points.length <= 8 ||
                  i % Math.ceil(points.length / 6) === 0,
              )
              .map((point) => (
                <span key={point.label}>
                  {point.label.slice(5).replace("-", "/")}
                </span>
              ))}
          </div>
        </>
      )}
    </figure>
  );
}

export function RingChart({
  title,
  segments,
  unit = "Tokens",
}: {
  title: string;
  segments: { label: string; value: number; color?: string }[];
  unit?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = segments.reduce(
    (sum, segment) => sum + Math.max(0, segment.value),
    0,
  );
  const radius = 52,
    length = 2 * Math.PI * radius;
  let offset = 0;
  const selected = active === null ? null : segments[active];
  return (
    <figure className="ring-chart" aria-label={title}>
      <div className="ring-visual">
        <svg viewBox="0 0 136 136" aria-hidden="true">
          <circle
            cx="68"
            cy="68"
            r={radius}
            fill="none"
            stroke="var(--line)"
            strokeWidth="11"
          />
          {segments.map((segment, i) => {
            const fraction = total ? Math.max(0, segment.value) / total : 0,
              start = offset;
            offset += fraction * length;
            return (
              <circle
                key={segment.label}
                cx="68"
                cy="68"
                r={radius}
                fill="none"
                stroke={segment.color ?? chartColors[i % chartColors.length]}
                strokeWidth={active === i ? 14 : 11}
                strokeDasharray={`${Math.max(0, fraction * length - 3)} ${length}`}
                strokeDashoffset={-start}
                transform="rotate(-90 68 68)"
                className="ring-segment"
              />
            );
          })}
        </svg>
        <div className="ring-center" aria-live="polite">
          <strong>{shortNumber(selected?.value ?? total)}</strong>
          <span>{selected?.label ?? (total ? unit : "暂无记录")}</span>
        </div>
      </div>
      <div className="ring-legend">
        {segments.map((segment, i) => (
          <button
            key={segment.label}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            onClick={() => setActive(i)}
            aria-label={`${segment.label}：${number(segment.value)} ${unit}`}
          >
            <span
              className="legend-dot"
              style={{
                background:
                  segment.color ?? chartColors[i % chartColors.length],
              }}
            />
            <span>{segment.label}</span>
            <strong>
              {total ? Math.round((segment.value / total) * 100) : 0}%
            </strong>
            <small>{shortNumber(segment.value)}</small>
          </button>
        ))}
      </div>
    </figure>
  );
}

export function BalanceBars({
  title,
  rows,
  unit = "积分",
}: {
  title: string;
  rows: {
    label: string;
    value: number | null;
    detail?: string;
    color?: string;
  }[];
  unit?: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value ?? 0));
  return (
    <figure className="balance-bars" aria-label={title}>
      {rows.length ? (
        rows.map((row, i) => (
          <div className="balance-bar-row" key={row.label + i}>
            <div>
              <span title={row.label}>{row.label}</span>
              <strong>
                {number(row.value)} <small>{unit}</small>
              </strong>
            </div>
            <div className="balance-track">
              <span
                style={{
                  width: `${row.value === null ? 0 : (Math.max(0, row.value) / max) * 100}%`,
                  background: row.color ?? chartColors[i % chartColors.length],
                }}
              />
            </div>
            {row.detail && <small>{row.detail}</small>}
          </div>
        ))
      ) : (
        <p className="subtle-empty">暂无数据</p>
      )}
    </figure>
  );
}
