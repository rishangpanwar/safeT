"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Gauge, HeartPulse, PersonStanding, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/health";

// Shape of evaluation/results/accuracy.json (written by `npm run evaluate` in smart-tourist-server).
type Spread = { mean: number; min: number; max: number };
type HeadlineKey = "sessionAccuracy" | "sensitivity" | "specificity" | "windowF1" | "falseAlarmsPerHour" | "healthyFlagged" | "rocAuc";
type Binary = { accuracy: number; precision: number; recall: number; specificity: number; f1: number };
type ScenarioResult = { sessions: number; detected: number; sensitivity: number; medianLatencyS: number | null; p90LatencyS: number | null; medianEarlyWarningS: number | null };
type DetectorName = "mews" | "iforest" | "fusedBasic" | "fused";
type DetectorReport = { session: Binary; window: Binary; falseAlarmsPerHour: number; healthyNonGreenFraction: number; perScenario: Record<string, ScenarioResult> };
type VitalsReport = { iforestRocAuc: number; detectors: Record<DetectorName, DetectorReport> };
type FallClass = { label: string; positive: boolean; traces: number; flagRate: { fourStage: number; final: number } };

interface AccuracyReport {
  generatedAt: string;
  quick: boolean;
  note: string;
  vitals: {
    seeds: number[];
    config: { normalSessions: number; restingSessions: number; sessionsPerScenario: number; healthyHours: number; windowsScored: number };
    headlineLabels: Record<HeadlineKey, string>;
    summary: Record<"original" | "final", Record<HeadlineKey, Spread>>;
    detail: { original: VitalsReport; final: VitalsReport };
  };
  falls: {
    config: { tracesPerClass: number };
    perClass: Record<string, FallClass>;
    overall: Record<"fourStage" | "final", Binary>;
  };
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const fmtKey = (k: HeadlineKey, x: number) => (k === "falseAlarmsPerHour" || k === "rocAuc" ? x.toFixed(3) : pct(x));
/** For these metrics a lower value is better. */
const LOWER_IS_BETTER: HeadlineKey[] = ["falseAlarmsPerHour", "healthyFlagged"];

const DETECTOR_LABELS: Record<DetectorName, string> = {
  mews: "MEWS alone",
  iforest: "Isolation Forest alone",
  fusedBasic: "Original fusion",
  fused: "Final fusion (kinematic context)",
};
const SCENARIO_LABELS: Record<string, string> = {
  ams: "Acute mountain sickness → HAPE",
  cardiac: "Cardiac event",
  hypothermia: "Hypothermia",
  heatstroke: "Heatstroke",
  fall: "Fall, then motionless",
};

function Bar({ value, good }: { value: number; good: boolean }) {
  return (
    <div className="h-2 w-full min-w-16 rounded-full bg-gray-100" aria-hidden>
      <div className="h-2 rounded-full" style={{ width: `${Math.max(value * 100, value > 0 ? 2 : 0)}%`, background: good ? "#0ca30c" : "#d03b3b" }} />
    </div>
  );
}

function Stat({ label, k, s }: { label: string; k: HeadlineKey; s: AccuracyReport["vitals"]["summary"] }) {
  const before = s.original[k].mean;
  const after = s.final[k].mean;
  const better = LOWER_IS_BETTER.includes(k) ? after < before : after > before;
  return (
    <Card className="py-0">
      <CardContent className="p-4">
        <p className="text-xs text-gray-600">{label}</p>
        <p className="text-2xl font-bold text-gray-900">{fmtKey(k, after)}</p>
        <p className={`flex items-center gap-1 text-xs ${better ? "text-[#0a7a0a]" : "text-gray-600"}`}>
          was {fmtKey(k, before)} <ArrowRight className="h-3 w-3" aria-hidden /> now {fmtKey(k, after)}
        </p>
      </CardContent>
    </Card>
  );
}

export default function AccuracyPage() {
  const [report, setReport] = useState<AccuracyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<AccuracyReport>("/api/health/evaluation").then(setReport).catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-xl p-10 text-center">
        <Gauge className="mx-auto mb-3 h-10 w-10 text-gray-400" />
        <p className="mb-2 font-semibold text-gray-800">No accuracy results to show</p>
        <p className="text-sm text-gray-600">{error}</p>
      </div>
    );
  }
  if (!report) return <div className="p-10 text-center text-gray-500">Loading…</div>;

  const v = report.vitals;
  const s = v.summary;
  const fin = v.detail.final;
  const orig = v.detail.original;
  const falls = report.falls;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-4">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Gauge className="h-7 w-7 text-blue-600" /> Model Accuracy
          </h1>
          <p className="text-sm text-gray-600">
            How reliably the AI recognises emergencies, measured on simulated trekkers and motion traces. The original system is compared with the final one on identical data.
          </p>
        </div>

        <div className="mb-6 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {report.note} Generated {new Date(report.generatedAt).toLocaleString()}
            {report.quick ? " (quick run)" : ""}. Re-run with <code className="rounded bg-amber-100 px-1">npm run evaluate</code>.
          </span>
        </div>

        {/* ---------------------------------------------------------------- vital signs */}
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-gray-900">
          <HeartPulse className="h-5 w-5 text-[#d03b3b]" /> Clinical detection (vital signs)
        </h2>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Session accuracy" k="sessionAccuracy" s={s} />
          <Stat label="Emergencies detected (sensitivity)" k="sensitivity" s={s} />
          <Stat label="Healthy trekkers alarm-free" k="specificity" s={s} />
          <Stat label="False alarms per trekker-hour" k="falseAlarmsPerHour" s={s} />
        </div>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-base">Original vs final system</CardTitle>
            <CardDescription>
              Mean (and range) over {v.seeds.length} independent simulations of {v.config.normalSessions + v.config.restingSessions} healthy and{" "}
              {v.config.sessionsPerScenario * 5} emergency sessions each ({Math.round(v.config.healthyHours)} healthy trekker-hours per run).
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b text-left text-gray-600">
                  <th className="py-2 pr-4 font-medium">Metric</th>
                  <th className="py-2 pr-4 font-medium">Original</th>
                  <th className="py-2 font-medium">Final</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(v.headlineLabels) as HeadlineKey[]).map((k) => (
                  <tr key={k} className="border-b last:border-0">
                    <td className="py-2 pr-4 text-gray-800">{v.headlineLabels[k]}</td>
                    <td className="py-2 pr-4 tabular-nums text-gray-700">
                      {fmtKey(k, s.original[k].mean)} <span className="text-xs text-gray-500">({fmtKey(k, s.original[k].min)}–{fmtKey(k, s.original[k].max)})</span>
                    </td>
                    <td className="py-2 font-semibold tabular-nums text-gray-900">
                      {fmtKey(k, s.final[k].mean)} <span className="text-xs font-normal text-gray-500">({fmtKey(k, s.final[k].min)}–{fmtKey(k, s.final[k].max)})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="mb-8 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ablation: which part does the work</CardTitle>
              <CardDescription>Seed 1, final forest. Window metrics score each 60 s assessment against the true condition.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[460px] text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-600">
                    <th className="py-2 pr-3 font-medium">Detector</th>
                    <th className="py-2 pr-3 font-medium">Sensitivity</th>
                    <th className="py-2 pr-3 font-medium">Specificity</th>
                    <th className="py-2 pr-3 font-medium">Window F1</th>
                    <th className="py-2 font-medium">Healthy flagged</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(DETECTOR_LABELS) as DetectorName[]).map((d) => {
                    const x = fin.detectors[d];
                    return (
                      <tr key={d} className={`border-b last:border-0 ${d === "fused" ? "font-semibold text-gray-900" : "text-gray-700"}`}>
                        <td className="py-2 pr-3">{DETECTOR_LABELS[d]}</td>
                        <td className="py-2 pr-3 tabular-nums">{pct(x.session.recall)}</td>
                        <td className="py-2 pr-3 tabular-nums">{pct(x.session.specificity)}</td>
                        <td className="py-2 pr-3 tabular-nums">{pct(x.window.f1)}</td>
                        <td className="py-2 tabular-nums">{pct(x.healthyNonGreenFraction)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-gray-600">
                Isolation Forest ROC-AUC: {orig.iforestRocAuc.toFixed(3)} without → {fin.iforestRocAuc.toFixed(3)} with the learned heart-rate/activity coupling.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Per emergency type</CardTitle>
              <CardDescription>Seed 1. Seconds count from the moment the condition starts developing.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[460px] text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-600">
                    <th className="py-2 pr-3 font-medium">Condition</th>
                    <th className="py-2 pr-3 font-medium">Original</th>
                    <th className="py-2 pr-3 font-medium">Final</th>
                    <th className="py-2 font-medium">Median time to Red</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(fin.detectors.fused.perScenario).map(([sc, f]) => {
                    const o = orig.detectors.fusedBasic.perScenario[sc];
                    return (
                      <tr key={sc} className="border-b text-gray-700 last:border-0">
                        <td className="py-2 pr-3 text-gray-800">{SCENARIO_LABELS[sc] ?? sc}</td>
                        <td className="py-2 pr-3 tabular-nums">{pct(o.sensitivity, 0)}</td>
                        <td className="py-2 pr-3 font-semibold tabular-nums text-gray-900">{pct(f.sensitivity, 0)}</td>
                        <td className="py-2 tabular-nums">{f.medianLatencyS == null ? "–" : `${f.medianLatencyS} s`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>

        {/* ---------------------------------------------------------------- falls */}
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-gray-900">
          <PersonStanding className="h-5 w-5 text-blue-600" /> Fall detection (phone motion sensors)
        </h2>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {(["accuracy", "recall", "specificity", "f1"] as const).map((m) => (
            <Card key={m} className="py-0">
              <CardContent className="p-4">
                <p className="text-xs text-gray-600">{{ accuracy: "Accuracy", recall: "Falls detected (recall)", specificity: "Everyday movement ignored", f1: "F1 score" }[m]}</p>
                <p className="text-2xl font-bold text-gray-900">{pct(falls.overall.final[m])}</p>
                <p className="text-xs text-gray-600">four-stage only: {pct(falls.overall.fourStage[m])}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-base">Per movement type</CardTitle>
            <CardDescription>
              {falls.config.tracesPerClass} simulated 50 Hz traces per movement, each with a random phone orientation. Share of traces confirmed as an incapacitating fall.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-left text-gray-600">
                  <th className="py-2 pr-3 font-medium">Movement</th>
                  <th className="py-2 pr-3 font-medium">Should alarm</th>
                  <th className="w-1/4 py-2 pr-3 font-medium">Four-stage (report)</th>
                  <th className="w-1/4 py-2 font-medium">Final (with collapse path)</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(falls.perClass).map(([cls, c]) => (
                  <tr key={cls} className="border-b text-gray-700 last:border-0">
                    <td className="py-2 pr-3 text-gray-800">{c.label}</td>
                    <td className="py-2 pr-3">{c.positive ? "Yes" : "No"}</td>
                    {(["fourStage", "final"] as const).map((variant) => {
                      const rate = c.flagRate[variant];
                      return (
                        <td key={variant} className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <span className="w-12 tabular-nums">{pct(rate, 0)}</span>
                            <Bar value={rate} good={c.positive ? rate >= 0.9 : rate <= 0.05} />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-gray-600">
              A dropped phone that lands still looks like a fall to any motion-only detector. That is why every detection first shows the 30 s &quot;Are you OK?&quot; check: the owner picks the
              phone up and cancels it.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <RefreshCw className="h-4 w-4 text-blue-600" /> What changed after the first evaluation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-2 pl-5 text-sm text-gray-700">
              <li>
                <strong>Heart-rate/activity coupling.</strong> The Isolation Forest scored a motionless casualty with a heart rate of 110 as normal, because each value is ordinary on its own.
                Training now learns how heart rate follows movement, and the unexplained heart rate becomes an extra split dimension.
              </li>
              <li>
                <strong>Activity-aware triage.</strong> MEWS was designed for patients at rest, so it flagged a large share of healthy trekking. A fast heart rate while walking no longer
                escalates when the forest confirms it fits the effort; a heart rate above 100 bpm after 2 minutes of complete stillness now triggers the self-check.
              </li>
              <li>
                <strong>Collapse detection.</strong> Someone who faints crumples without a true free fall, so the four-stage detector missed every collapse. A soft impact after the knees
                buckle now also counts, but needs 20 s of motionless lying with no voluntary turning.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
