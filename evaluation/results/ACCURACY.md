# Accuracy evaluation

Generated 2026-11-21T11:07:01.699Z by `npm run evaluate` (smart-tourist-server). All data is synthetic: these numbers compare algorithm versions, they are not clinical validation.

## 1. Clinical detection pipeline (vital signs)

Each seed simulates 120 healthy trekking sessions and 40 healthy resting sessions of 30 min, plus 60 episodes each of ams, cardiac, hypothermia, heatstroke, fall (5 min healthy, then 15 min of pathology). Vitals stream at 1 Hz through the real feature window, Isolation Forest, MEWS and fusion code; an assessment is made every 5 s (124,540 per seed, 98 healthy trekker-hours). The forest is trained on a different generator (features.ts) than the one tested on (physiology.ts).

### Headline: mean (min–max) over 5 seeds

| Metric | Original system | Final system |
|---|---|---|
| Session accuracy | 90.0% (88.9%–90.9%) | 99.3% (98.7%–99.8%) |
| Sensitivity (episodes detected) | 86.5% (85.0%–88.0%) | 99.9% (99.7%–100.0%) |
| Specificity (healthy sessions alarm-free) | 96.5% (94.4%–98.8%) | 98.3% (96.9%–100.0%) |
| Window F1 (Red vs established pathology) | 84.1% (83.5%–84.8%) | 96.9% (96.7%–97.1%) |
| False Red alarms per trekker-hour | 0.280 (0.174–0.418) | 0.137 (0.041–0.225) |
| Healthy time shown Yellow/Red | 28.0% (25.9%–29.1%) | 7.6% (4.5%–9.8%) |
| Isolation Forest ROC-AUC | 0.923 (0.917–0.933) | 0.961 (0.958–0.964) |

Original = plain Isolation Forest + MEWS/critical-score fusion. Final = forest with HR-activity coupling + kinematic fusion context.

### Ablation (seed 1, final forest)

| Detector | Session acc. | Sensitivity | Specificity | Window acc. | Precision | Recall | F1 | False alarms/h | Healthy flagged |
|---|---|---|---|---|---|---|---|---|---|
| MEWS alone | 88.9% | 85.7% | 95.0% | 88.4% | 95.9% | 73.2% | 83.1% | 0.316 | 29.0% |
| Isolation Forest alone | 75.4% | 62.3% | 100.0% | 69.5% | 100.0% | 21.6% | 35.5% | 0.000 | 4.7% |
| Original fusion | 89.1% | 86.0% | 95.0% | 88.5% | 95.9% | 73.6% | 83.3% | 0.316 | 29.0% |
| Final fusion (kinematic context) | 98.7% | 99.7% | 96.9% | 97.5% | 99.7% | 93.8% | 96.7% | 0.204 | 8.8% |

Isolation Forest ROC-AUC (seed 1): 0.917 plain → 0.958 with HR-activity coupling.

### Per pathology (seed 1)

| Pathology | Original: detected | Final: detected | Final: median s to Red | Final: 90th pct s | Final: median s to first warning |
|---|---|---|---|---|---|
| ams | 60/60 (100.0%) | 60/60 (100.0%) | 84 | 139 | 44 |
| cardiac | 60/60 (100.0%) | 60/60 (100.0%) | 109 | 204 | 74 |
| hypothermia | 59/60 (98.3%) | 59/60 (98.3%) | 289 | 444 | 89 |
| heatstroke | 60/60 (100.0%) | 60/60 (100.0%) | 174 | 249 | 94 |
| fall | 18/60 (30.0%) | 60/60 (100.0%) | 139 | 144 | 64 |

Latency counts from the moment the pathology starts developing (it reaches its full severity over 2–8 min).

## 2. Fall detector (50 Hz motion)

200 synthetic traces per class, each with a random phone orientation and sensor noise. A trace counts as flagged if the detector confirms an incapacitating fall.

| Movement | Should alarm? | Four-stage (report) | Final (with collapse path) |
|---|---|---|---|
| Trip / slip fall, stays down | yes | 100.0% | 100.0% |
| Fall from height, stays down | yes | 100.0% | 100.0% |
| Collapse (syncope), stays down | yes | 0.0% | 99.0% |
| Walking | no | 0.0% | 0.0% |
| Running | no | 0.0% | 0.0% |
| Jumping | no | 0.0% | 0.0% |
| Sitting down hard | no | 0.0% | 0.0% |
| Lying down to rest | no | 0.0% | 0.0% |
| Flopping down to rest (awake) | no | 0.0% | 0.0% |
| Phone dropped on the ground | no | 61.0% | 61.0% |
| Fall, then gets up | no | 18.0% | 18.0% |

| Variant | Accuracy | Precision | Recall | Specificity | F1 |
|---|---|---|---|---|---|
| Four-stage (report) | 83.7% | 71.7% | 66.7% | 90.1% | 69.1% |
| Final | 92.7% | 79.1% | 99.7% | 90.1% | 88.2% |

Pooled metrics use equal traces per class, so they depend on that mix; the per-class rates do not.

## 3. What changed, and why

- **HR-activity coupling (Isolation Forest).** Axis-parallel isolation could not see that "motionless at 110 bpm" is abnormal: each value is ordinary on its own axis. Training now fits HR ≈ a + b·Mobility on healthy data and adds the unexplained heart rate as a split dimension. X and Eq. 2.1–2.2 are unchanged.
- **Kinematic fusion context.** MEWS was designed for patients at rest. While walking with a normal forest score, exertional tachycardia is not escalated (bradycardia always is); HR > 100 bpm after ≥ 2 min of complete stillness raises the 30 s self-check. The MEWS total is still reported per Table 2.1.
- **Low-energy collapse path (fall detector).** A faint has no free fall below 0.5 g, so the four-stage path missed every collapse. Partial unloading (< 0.85 g) then an impact ≥ 1.8 g with rotation ≥ 100 °/s now also opens Stage 3–4, which then requires 20 s motionless with no voluntary rotation (< 20 °/s).

## 4. Known limitations

- Synthetic data only; thresholds need validation on real wearable recordings before clinical use.
- A dropped phone that lands still is flagged by both fall-detector variants. The 30 s self-check exists for exactly this: the owner picks the phone up and taps "I'm OK".
- Remaining false Red alarms come from trekkers walking above ~4,500 m with SpO₂ ≤ 90 %, where the hypoxia-corridor rule deliberately asks for a self-check.
