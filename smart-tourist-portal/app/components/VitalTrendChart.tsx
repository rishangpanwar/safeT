"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { VitalPoint } from "@/lib/health";

type Key = "hr" | "spo2" | "skinTemp";

const SERIES = "#2a78d6"; // single series → categorical slot 1
const H = 120;
const PAD = { top: 10, right: 44, bottom: 20, left: 34 };

/**
 * One vital, one axis (small multiples — never a dual axis). Dashed reference lines mark
 * the MEWS band edges so the reader sees where a score starts to accrue.
 */
export default function VitalTrendChart({
  data,
  field,
  title,
  unit,
  bands = [],
  floor,
  ceil,
  decimals = 0,
}: {
  data: VitalPoint[];
  field: Key;
  title: string;
  unit: string;
  bands?: { value: number; label: string }[];
  floor?: number;
  ceil?: number;
  decimals?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const pts = useMemo(() => data.filter((d) => typeof d[field] === "number") as (VitalPoint & Record<Key, number>)[], [data, field]);

  if (pts.length < 2) {
    return (
      <div ref={wrap} className="rounded-lg border border-gray-200 bg-white p-3">
        <p className="text-xs font-medium text-gray-600">{title}</p>
        <p className="py-8 text-center text-xs text-gray-400">No telemetry in this window</p>
      </div>
    );
  }

  const values = pts.map((p) => p[field]);
  const lo = Math.min(floor ?? Infinity, ...values, ...bands.map((b) => b.value));
  const hi = Math.max(ceil ?? -Infinity, ...values, ...bands.map((b) => b.value));
  const span = hi - lo || 1;
  const yMin = lo - span * 0.08;
  const yMax = hi + span * 0.08;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + ((t - t0) / (t1 - t0 || 1)) * innerW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p[field]).toFixed(1)}`).join("");
  const last = pts[pts.length - 1];
  const hp = hover != null ? pts[hover] : null;
  const fmt = (v: number) => v.toFixed(decimals);
  const ticks = [yMin + (yMax - yMin) * 0.15, (yMin + yMax) / 2, yMax - (yMax - yMin) * 0.15];

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const t = t0 + ((e.clientX - box.left) / box.width) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].t - t) < Math.abs(pts[best].t - t)) best = i;
    setHover(best);
  };

  return (
    <div ref={wrap} className="relative rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-medium text-gray-600">{title}</p>
        <p className="text-sm font-semibold text-gray-900">
          {fmt(last[field])} <span className="text-xs font-normal text-gray-500">{unit}</span>
        </p>
      </div>
      <svg width={width - 24} height={H} role="img" aria-label={`${title} trend, latest ${fmt(last[field])} ${unit}`} className="block">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={width - 24 - PAD.right} y1={y(v)} y2={y(v)} stroke="#e5e7eb" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="#6b7280">
              {fmt(v)}
            </text>
          </g>
        ))}
        {bands.map((b) => (
          <g key={b.value}>
            <line x1={PAD.left} x2={width - 24 - PAD.right} y1={y(b.value)} y2={y(b.value)} stroke="#9ca3af" strokeWidth={1} strokeDasharray="4 3" />
            <text x={width - 24 - PAD.right + 4} y={y(b.value) + 3} fontSize={9} fill="#52514e">
              {b.label}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last.t)} cy={y(last[field])} r={4} fill={SERIES} stroke="#fff" strokeWidth={2} />
        <text x={PAD.left} y={H - 4} fontSize={10} fill="#6b7280">
          {new Date(t0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </text>
        <text x={width - 24 - PAD.right} y={H - 4} fontSize={10} fill="#6b7280" textAnchor="end">
          {new Date(t1).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </text>
        {hp && (
          <g pointerEvents="none">
            <line x1={x(hp.t)} x2={x(hp.t)} y1={PAD.top} y2={H - PAD.bottom} stroke="#52514e" strokeWidth={1} />
            <circle cx={x(hp.t)} cy={y(hp[field])} r={4} fill={SERIES} stroke="#fff" strokeWidth={2} />
          </g>
        )}
        <rect
          x={PAD.left}
          y={0}
          width={Math.max(0, innerW)}
          height={H}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hp && (
        <div
          className="pointer-events-none absolute top-8 z-10 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs shadow"
          style={{ left: Math.min(Math.max(x(hp.t) - 40, 0), width - 110) }}
        >
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3" style={{ background: SERIES }} />
            <span className="font-semibold text-gray-900">
              {fmt(hp[field])} {unit}
            </span>
          </div>
          <div className="text-gray-500">{new Date(hp.t).toLocaleTimeString()}</div>
        </div>
      )}
    </div>
  );
}
