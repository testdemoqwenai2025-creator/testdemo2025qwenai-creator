#!/usr/bin/env python3
"""
Render Phase 9 plots for the nbody-fold-scala scientific report:
  1. scaling.png   — per-step wall-clock vs N (log-log)
  2. energy-drift.png — relative energy drift vs step count (semilogy)

Reads:
  /home/z/my-project/download/nbody-fold-scala/results/benchmark.csv
  /home/z/my-project/download/nbody-fold-scala/results/energy-drift.csv

Writes:
  /home/z/my-project/download/nbody-fold-scala/results/scaling.png
  /home/z/my-project/download/nbody-fold-scala/results/energy-drift.png
"""
import csv
import math
import os
import matplotlib.font_manager as fm

# Register fonts: Noto Sans SC for CJK + DejaVu Sans for Latin/symbol fallback.
# matplotlib ≥ 3.9 does per-glyph fallback, so missing glyphs in the primary
# font are automatically pulled from the next font in the list.
for fpath in [
    "/usr/share/fonts/truetype/chinese/NotoSansSC-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]:
    if os.path.exists(fpath):
        fm.fontManager.addfont(fpath)

import matplotlib.pyplot as plt

plt.rcParams["font.sans-serif"] = ["Noto Sans SC", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False  # render '-' as ASCII, not CJK box

# Low-saturation Paul-Tol-inspired palette (colorblind-safe).
# BruteForce = blue, BarnesHut = teal, FoldRLE = orange, FoldDoubleRLE = red.
COLORS = {
    "BruteForce":     "#0077BB",
    "BarnesHut":      "#009988",
    "FoldRLE":        "#EE7733",
    "FoldDoubleRLE":  "#CC3311",
}
MARKERS = {
    "BruteForce":     "o",
    "BarnesHut":      "s",
    "FoldRLE":        "^",
    "FoldDoubleRLE":  "D",
}

# Asymptotic reference lines (for the scaling plot legend).
# O(N²) = BruteForce; O(N log N) = BarnesHut; O(N × cells) ≈ O(N^(4/3)) heuristic for FoldRLE.
ASYM_LABEL = {
    "BruteForce":     r"$O(N^2)$",
    "BarnesHut":      r"$O(N \log N)$",
    "FoldRLE":        r"$O(N \times \mathrm{cells})$",
    "FoldDoubleRLE":  r"$O(N \times \mathrm{cells})$",
}

RESULTS_DIR = "/home/z/my-project/download/nbody-fold-scala/results"
BENCH_CSV   = os.path.join(RESULTS_DIR, "benchmark.csv")
DRIFT_CSV   = os.path.join(RESULTS_DIR, "energy-drift.csv")
SCALING_PNG = os.path.join(RESULTS_DIR, "scaling.png")
DRIFT_PNG   = os.path.join(RESULTS_DIR, "energy-drift.png")


# ────────────────────────────────────────────────────────────────────────────
# 1. scaling.png  — per-step wall-clock vs N (log-log)
# ────────────────────────────────────────────────────────────────────────────
def render_scaling():
    # Parse benchmark.csv. Skip SKIPPED rows. Collect (N, mean_ms) per algo.
    series = {a: ([], []) for a in COLORS}  # algo -> (Ns, means)
    extrapolated = {  # algo -> list of (N, mean_ms) for extrapolated rows
        "BruteForce": [],
    }

    with open(BENCH_CSV, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            algo = row["algorithm"]
            n = int(row["n"])
            mean_str = row["mean_ms"]
            if mean_str == "SKIPPED" or mean_str == "":
                # BruteForce extrapolated rows (N=10k, 100k) have mean_ms but
                # empty std/cv/etc. We keep them as extrapolated points.
                continue
            mean_ms = float(mean_str)
            # Determine if this is an extrapolated row (no std_ms value)
            is_extrapolated = row["std_ms"] == "" or row["std_ms"] is None
            if is_extrapolated and algo in extrapolated:
                extrapolated[algo].append((n, mean_ms))
            elif algo in series:
                series[algo][0].append(n)
                series[algo][1].append(mean_ms)

    fig, ax = plt.subplots(figsize=(9, 6.2), constrained_layout=True)

    # Plot measured points with lines + markers
    for algo in ["BruteForce", "BarnesHut", "FoldRLE", "FoldDoubleRLE"]:
        ns, means = series[algo]
        if not ns:
            continue
        ax.plot(ns, means,
                color=COLORS[algo],
                marker=MARKERS[algo],
                markersize=7,
                linewidth=1.8,
                label=f"{algo}  {ASYM_LABEL[algo]}")

    # Plot extrapolated BruteForce points with dashed style + open markers
    if extrapolated["BruteForce"]:
        ns_ext = [n for n, _ in extrapolated["BruteForce"]]
        ms_ext = [m for _, m in extrapolated["BruteForce"]]
        # Connect to last measured point (N=1024) for visual continuity
        last_measured_n = 1024
        last_measured_ms = None
        for n, m in zip(series["BruteForce"][0], series["BruteForce"][1]):
            if n == last_measured_n:
                last_measured_ms = m
                break
        if last_measured_ms is not None:
            ax.plot([last_measured_n] + ns_ext,
                    [last_measured_ms] + ms_ext,
                    color=COLORS["BruteForce"],
                    linestyle=":",
                    linewidth=1.4,
                    marker=MARKERS["BruteForce"],
                    markersize=7,
                    markerfacecolor="white",
                    markeredgecolor=COLORS["BruteForce"],
                    markeredgewidth=1.5,
                    label="BruteForce (extrapolated)")

    # Reference guide lines: O(N²), O(N log N), O(N)
    # Anchor at the bottom-left data point (N=128, ~0.1 ms)
    n_ref = [128, 100000]
    base_n, base_t = 128, 0.1  # 0.1 ms at N=128
    ax.plot(n_ref, [base_t, base_t * (n_ref[1] / n_ref[0]) ** 2],
            color="#94A3B8", linewidth=1.0, linestyle="--", alpha=0.7,
            label=r"$O(N^2)$ guide")
    ax.plot(n_ref, [base_t, base_t * (n_ref[1] / n_ref[0]) * math.log(n_ref[1]) / math.log(n_ref[0])],
            color="#A1A1AA", linewidth=1.0, linestyle="-.", alpha=0.7,
            label=r"$O(N \log N)$ guide")

    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlabel("N (number of bodies)", fontsize=12)
    ax.set_ylabel("per-step wall-clock time (ms)", fontsize=12)
    ax.set_title("N-Body Solver Scaling: BruteForce vs BarnesHut vs Fold+RLE vs Fold+DoubleRLE",
                 fontsize=13, pad=10)
    ax.grid(True, which="both", linestyle="-", linewidth=0.4, alpha=0.3)
    ax.grid(True, which="major", linestyle="-", linewidth=0.6, alpha=0.5)

    # Legend outside on the right
    ax.legend(loc="upper left", bbox_to_anchor=(1.02, 1.0),
              fontsize=9.5, frameon=False, title="Algorithm", title_fontsize=10.5)

    # Annotate the practical regime boundary
    ax.axvline(x=1024, color="#CBD5E1", linewidth=0.8, linestyle=":", alpha=0.6)
    ax.text(1024 * 1.05, 0.15, "BruteForce\nmeasured → extrapolated",
            fontsize=8.5, color="#64748B", va="bottom", ha="left")

    fig.savefig(SCALING_PNG, dpi=300)
    plt.close(fig)
    print(f"Wrote: {SCALING_PNG} ({os.path.getsize(SCALING_PNG)} bytes)")


# ────────────────────────────────────────────────────────────────────────────
# 2. energy-drift.png  — relative energy drift vs step count (semilogy)
# ────────────────────────────────────────────────────────────────────────────
def render_energy_drift():
    steps, drifts = [], []
    with open(DRIFT_CSV, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            steps.append(int(row["steps"]))
            drifts.append(float(row["energy_drift"]))

    fig, ax = plt.subplots(figsize=(8.5, 5.2), constrained_layout=True)

    ax.semilogy(steps, drifts,
                color="#0077BB",
                marker="o",
                markersize=8,
                linewidth=1.8,
                label="BruteForce KDK leapfrog, dt=0.005, softening=0.05")

    # Stability threshold reference line (5e-3)
    ax.axhline(y=5e-3, color="#CC3311", linewidth=1.2, linestyle="--",
               alpha=0.8, label="Stability threshold (5×10⁻³)")

    # Symplectic integrator theoretical bound (~dt² for leapfrog)
    # dt = 0.005 → dt² = 2.5e-5. Plot as a reference.
    ax.axhline(y=2.5e-5, color="#94A3B8", linewidth=1.0, linestyle=":",
               alpha=0.7, label=r"Leapfrog theoretical bound ($\Delta t^2 \approx 2.5 \times 10^{-5}$)")

    ax.set_xlabel("Step count", fontsize=12)
    ax.set_ylabel("Relative energy drift  |E(t) − E(0)| / |E(0)|", fontsize=12)
    ax.set_title("Energy Conservation: Plummer N=256, BruteForce KDK Leapfrog\n"
                 "(softening=0.05, dt=0.005, collisionless regime)",
                 fontsize=12.5, pad=10)
    ax.grid(True, which="both", linestyle="-", linewidth=0.4, alpha=0.3)
    ax.grid(True, which="major", linestyle="-", linewidth=0.6, alpha=0.5)
    ax.set_ylim(1e-7, 1e-2)

    # Annotate each data point with its drift value
    for s, d in zip(steps, drifts):
        ax.annotate(f"{d:.1e}",
                    xy=(s, d),
                    xytext=(8, 6),
                    textcoords="offset points",
                    fontsize=8,
                    color="#475569")

    ax.legend(loc="lower right", fontsize=9.5, frameon=False)

    fig.savefig(DRIFT_PNG, dpi=300)
    plt.close(fig)
    print(f"Wrote: {DRIFT_PNG} ({os.path.getsize(DRIFT_PNG)} bytes)")


if __name__ == "__main__":
    render_scaling()
    render_energy_drift()
    print("\nDone. Both plots written to", RESULTS_DIR)
