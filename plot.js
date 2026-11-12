// An SVG line plot with axes, for one curve and a few marked points. No libraries.
const NS = "http://www.w3.org/2000/svg";
const W = 640;
const H = 340;
const PAD = { left: 64, right: 16, top: 16, bottom: 44 };

const node = (name, attrs = {}, text) => {
    const item = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) item.setAttribute(key, String(value));
    if (text !== undefined) item.textContent = text;
    return item;
};

/** Round tick positions between lo and hi, about `count` of them. */
export function ticks(lo, hi, count = 5) {
    const span = hi - lo;
    if (!(span > 0)) return [lo];
    const raw = span / count;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
    return out;
}

/** A short label for a number on an axis or in a table. */
export function fmt(value) {
    if (!Number.isFinite(value)) return String(value);
    if (value === 0) return "0";
    const abs = Math.abs(value);
    if (abs >= 1e5 || abs < 1e-3) return value.toExponential(2).replace("e+", "e");
    return String(Number(value.toPrecision(4)));
}

/**
 * options: { points: [[x, y]], xLabel, yLabel, marks: [{x, y, kind: "expect" | "got", ok}], at: x of the cursor or null }
 */
export function drawPlot({ points, xLabel, yLabel, marks = [], at = null }) {
    const svg = node("svg", {
        viewBox: `0 0 ${W} ${H}`,
        role: "img",
        class: "plot",
        "aria-label": `${yLabel} against ${xLabel}`,
    });
    const xs = points.map((p) => p[0]);
    const ys = [...points.map((p) => p[1]), ...marks.map((m) => m.y).filter(Number.isFinite)];
    if (!points.length) {
        svg.append(
            node("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "axis" }, "No finite values to plot."),
        );
        return svg;
    }
    const xLo = Math.min(...xs);
    const xHi = Math.max(...xs);
    let yLo = Math.min(...ys);
    let yHi = Math.max(...ys);
    if (yLo > 0 && yLo < (yHi - yLo) * 0.5) yLo = 0;
    if (yHi === yLo) {
        yLo -= 1;
        yHi += 1;
    }
    const pad = (yHi - yLo) * 0.06;
    yHi += pad;
    if (yLo !== 0) yLo -= pad;
    const sx = (x) => PAD.left + ((x - xLo) / (xHi - xLo || 1)) * (W - PAD.left - PAD.right);
    const sy = (y) => H - PAD.bottom - ((y - yLo) / (yHi - yLo)) * (H - PAD.top - PAD.bottom);

    for (const t of ticks(yLo, yHi)) {
        svg.append(node("line", { x1: PAD.left, x2: W - PAD.right, y1: sy(t), y2: sy(t), class: "grid" }));
        svg.append(node("text", { x: PAD.left - 8, y: sy(t) + 4, "text-anchor": "end", class: "axis" }, fmt(t)));
    }
    for (const t of ticks(xLo, xHi)) {
        svg.append(node("line", { x1: sx(t), x2: sx(t), y1: PAD.top, y2: H - PAD.bottom, class: "grid" }));
        svg.append(node("text", { x: sx(t), y: H - PAD.bottom + 18, "text-anchor": "middle", class: "axis" }, fmt(t)));
    }
    svg.append(
        node("line", { x1: PAD.left, x2: W - PAD.right, y1: H - PAD.bottom, y2: H - PAD.bottom, class: "frame" }),
    );
    svg.append(node("line", { x1: PAD.left, x2: PAD.left, y1: PAD.top, y2: H - PAD.bottom, class: "frame" }));
    svg.append(
        node("text", { x: (PAD.left + W - PAD.right) / 2, y: H - 6, "text-anchor": "middle", class: "label" }, xLabel),
    );
    svg.append(
        node(
            "text",
            { x: 14, y: H / 2, "text-anchor": "middle", class: "label", transform: `rotate(-90 14 ${H / 2})` },
            yLabel,
        ),
    );
    svg.append(
        node("polyline", {
            points: points.map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(" "),
            class: "curve",
        }),
    );
    if (at !== null && at >= xLo && at <= xHi)
        svg.append(node("line", { x1: sx(at), x2: sx(at), y1: PAD.top, y2: H - PAD.bottom, class: "cursor" }));
    for (const mark of marks) {
        if (!Number.isFinite(mark.y) || mark.x < xLo || mark.x > xHi) continue;
        const cls = mark.kind === "expect" ? "dot expect" : `dot got ${mark.ok ? "ok" : "bad"}`;
        svg.append(node("circle", { cx: sx(mark.x), cy: sy(mark.y), r: mark.kind === "expect" ? 7 : 4, class: cls }));
    }
    return svg;
}
