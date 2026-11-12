import { DEFAULT_MODELS } from "./config.js";
import {
    defaults,
    fixMessages,
    LawError,
    parseJson,
    readSpec,
    runChecks,
    sample,
    specMessages,
    TOPICS,
    valueAt,
} from "./law.js";
import { loadModels } from "./models.js";
import { drawPlot, fmt } from "./plot.js";
import { chat, clearSession, completeSignIn, getSession, startSignIn } from "./pollen.js";
import { $, el, money, notice, renderSession, SIGN_IN_PROBLEMS } from "./ui.js";

const state = { models: [], topic: "", versions: [], values: {}, xAt: 0, mark: null };
const seed = () => Math.floor(Math.random() * 1e9);
const latest = () => state.versions.at(-1);
const unit = (u) => (u ? ` ${u}` : "");
const sameEquations = (a, b) =>
    a.equations.map((q) => q.expression).join("|") === b.equations.map((q) => q.expression).join("|");
const matched = (v) => v.results.filter((r) => r.ok).length;

function estimate() {
    const model = state.models.find((m) => m.name === $("#model").value);
    const price = (key) => Number(model?.pricing?.[key] ?? 0);
    const cost = 600 * price("promptTextTokens") + 900 * price("completionTextTokens");
    $("#estimate").textContent = model
        ? `One law: ${money(cost)} Pollen (a rough estimate). A repair costs about the same again.`
        : "";
}

/** Reads a reply into a version: the model's JSON, the spec built from it, and the check results. */
function version(reply) {
    const raw = parseJson(reply);
    const spec = readSpec(raw);
    return { raw, spec, results: runChecks(spec) };
}

// ---- the plot and its sliders ----------------------------------------------------------------------

function drawCurrent() {
    const { spec } = latest();
    const marks = state.mark
        ? [
              { x: state.mark.x, y: state.mark.expect, kind: "expect" },
              { x: state.mark.x, y: state.mark.got, kind: "got", ok: state.mark.ok },
          ]
        : [];
    $("#plot").replaceChildren(
        drawPlot({
            points: sample(spec, state.values),
            xLabel: `${spec.x.label} (${spec.x.unit || spec.x.name})`,
            yLabel: `${spec.y.label} (${spec.y.unit || spec.y.equation})`,
            marks,
            at: state.xAt,
        }),
    );
    const y = valueAt(spec, { ...state.values, [spec.x.name]: state.xAt });
    $("#readout").textContent =
        `${spec.y.label} = ${fmt(y)}${unit(spec.y.unit)} at ${spec.x.name} = ${fmt(state.xAt)}${unit(spec.x.unit)}`;
}

function slider({ id, label, min, max, value, onInput }) {
    const wrap = el("div", "slider");
    const out = el("output", "", fmt(value));
    const input = Object.assign(document.createElement("input"), {
        type: "range",
        id,
        min,
        max,
        step: (max - min) / 400,
        value,
    });
    input.oninput = () => {
        out.textContent = fmt(Number(input.value));
        onInput(Number(input.value));
    };
    const title = el("label", "", `${label} `);
    title.append(out);
    title.htmlFor = id;
    wrap.append(title, input);
    return wrap;
}

function buildSliders() {
    const { spec } = latest();
    const box = $("#sliders");
    box.replaceChildren(
        slider({
            id: "s-x",
            label: `Read the curve at ${spec.x.name}${unit(spec.x.unit)}`,
            min: spec.x.min,
            max: spec.x.max,
            value: state.xAt,
            onInput: (v) => {
                state.xAt = v;
                state.mark = null;
                drawCurrent();
            },
        }),
    );
    for (const p of spec.parameters)
        box.append(
            slider({
                id: `s-${p.name}`,
                label: `${p.label} (${p.name}${unit(p.unit)})`,
                min: p.min,
                max: p.max,
                value: state.values[p.name],
                onInput: (v) => {
                    state.values[p.name] = v;
                    state.mark = null;
                    drawCurrent();
                },
            }),
        );
}

const setSlider = (id, value) => {
    const input = $(id);
    input.min = Math.min(Number(input.min), value);
    input.max = Math.max(Number(input.max), value);
    input.value = value;
    input.previousSibling.querySelector("output").textContent = fmt(value);
};

/** Moves every slider to a check point's values and marks the point on the curve. */
function goTo(result) {
    const { spec } = latest();
    for (const p of spec.parameters) {
        state.values[p.name] = result.at[p.name];
        setSlider(`#s-${p.name}`, result.at[p.name]);
    }
    state.xAt = result.at[spec.x.name];
    setSlider("#s-x", state.xAt);
    state.mark = { x: state.xAt, expect: result.expect, got: result.got, ok: result.ok };
    drawCurrent();
    $("#plot").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// ---- the page ------------------------------------------------------------------------------------------

const atText = (spec, at) =>
    [spec.x.name, ...spec.parameters.map((p) => p.name)].map((name) => `${name} = ${fmt(at[name])}`).join(", ");

function equationBlock(spec) {
    const box = el("div");
    for (const q of spec.equations) {
        const item = el("div", "eq");
        item.append(el("span", "tag", "The model's writing"), el("div", "", q.readable || "(none given)"));
        item.append(el("span", "tag", "What this page computes"), el("code", "", `${q.name} = ${q.expression}`));
        box.append(item);
    }
    return box;
}

function renderChecks() {
    const v = latest();
    const { spec, results } = v;
    const table = $("#checks");
    table.replaceChildren();
    const head = el("tr");
    for (const title of ["", "At", "The model expected", "The equations give", "Its note"])
        head.append(el("th", "", title));
    table.append(head);
    for (const r of results) {
        const tr = el("tr", "pick");
        tr.append(el("td", r.ok ? "ok" : "bad", r.ok ? "✓" : "✗"));
        tr.append(el("td", "", atText(spec, r.at)));
        tr.append(el("td", "", `${fmt(r.expect)}${unit(spec.y.unit)}`));
        tr.append(el("td", "", `${fmt(r.got)}${unit(spec.y.unit)}`));
        tr.append(el("td", "", r.note));
        tr.onclick = () => goTo(r);
        table.append(tr);
    }
    const good = matched(v);
    const verdict = $("#verdict");
    verdict.textContent =
        good === results.length
            ? `All ${good} worked examples match the equations (within 1%).`
            : `${good} of ${results.length} worked examples match. ${results.length - good} do not: the equations or the model's hand arithmetic are wrong.`;
    verdict.className = `verdict ${good === results.length ? "ok" : "bad"}`;
    $("#fix").hidden = good === results.length || state.versions.length > 1;
    $("#fix").disabled = false;
}

function renderVersions() {
    const box = $("#versions");
    box.replaceChildren();
    if (state.versions.length < 2) return;
    state.versions.forEach((v, i) => {
        const block = el("div", "version");
        block.append(el("h3", "", i === 0 ? "First answer" : "After one repair"));
        block.append(el("p", "fine", `${matched(v)} of ${v.results.length} worked examples match.`));
        block.append(equationBlock(v.spec));
        if (i > 0 && sameEquations(state.versions[0].spec, v.spec))
            block.append(
                el(
                    "p",
                    "fine",
                    "The equations did not change: the repair moved the model's expected numbers to fit them.",
                ),
            );
        for (const r of v.results.filter((x) => !x.ok))
            block.append(
                el(
                    "p",
                    "fine",
                    `✗ at ${atText(v.spec, r.at)}: expected ${fmt(r.expect)}, the equations give ${fmt(r.got)}.`,
                ),
            );
        box.append(block);
    });
}

function render() {
    const v = latest();
    const { spec } = v;
    $("#result").hidden = false;
    $("#law-title").textContent = spec.title;
    $("#law-text").textContent = spec.explanation;
    state.values = defaults(spec);
    state.xAt = (spec.x.min + spec.x.max) / 2;
    state.mark = null;
    buildSliders();
    drawCurrent();
    $("#equations").replaceChildren(equationBlock(spec));
    renderChecks();
    renderVersions();
    $("#sources").replaceChildren(
        ...(spec.sources.length ? spec.sources : ["(none given)"]).map((s) => el("li", "", s)),
    );
    $("#raw").textContent = JSON.stringify(v.raw, null, 2);
}

/** Asks the model; resolves to a version, or null after showing why not. */
async function ask(messages, button, working) {
    button.disabled = true;
    $("#progress").textContent = working;
    $("#bad").hidden = true;
    notice(null);
    try {
        const reply = await chat($("#model").value, messages, { seed: seed() });
        try {
            return version(reply);
        } catch (error) {
            if (!(error instanceof LawError)) throw error;
            $("#bad").hidden = false;
            $("#bad-text").textContent = reply;
            notice(`The model's answer could not be used: ${error.message}`, "error");
            return null;
        }
    } catch (error) {
        notice(error.message, "error");
        return null;
    } finally {
        button.disabled = false;
        $("#progress").textContent = "";
        renderSession();
    }
}

async function plot() {
    if (!getSession()) return startSignIn();
    const topic = $("#topic").value.trim();
    if (!topic) return notice("Write a topic first.", "error");
    state.topic = topic;
    const v = await ask(specMessages(topic), $("#run"), "Asking the model…");
    if (!v) return;
    state.versions = [v];
    render();
}

async function fix() {
    const v = latest();
    const failed = v.results.filter((r) => !r.ok);
    const next = await ask(fixMessages(state.topic, v.raw, failed), $("#fix"), "Asking the model to repair it…");
    if (!next) return;
    state.versions.push(next);
    render();
}

// Start.
$("#sign-in").onclick = () => startSignIn();
$("#sign-out").onclick = () => {
    clearSession();
    renderSession();
};
$("#run").onclick = plot;
$("#fix").onclick = fix;
$("#model").onchange = estimate;
$("#topic").value = TOPICS[0];
for (const topic of TOPICS)
    $("#presets").append(
        Object.assign(el("button", "button small", topic.replace(/ \(.*\)$/, "")), {
            type: "button",
            onclick: () => {
                $("#topic").value = topic;
            },
        }),
    );

const outcome = completeSignIn();
if (outcome && outcome !== "ok") notice(SIGN_IN_PROBLEMS[outcome], "error");
renderSession();
loadModels()
    .then((models) => {
        state.models = models;
        const first = new Set(DEFAULT_MODELS);
        const sorted = [...models].sort((a, b) => first.has(b.name) - first.has(a.name) || a.paidOnly - b.paidOnly);
        $("#model").replaceChildren(
            ...sorted.map((m) =>
                Object.assign(el("option", "", `${m.name}${m.paidOnly ? " (paid)" : ""}`), { value: m.name }),
            ),
        );
        $("#model").value = DEFAULT_MODELS.find((name) => models.some((m) => m.name === name)) ?? sorted[0]?.name;
        estimate();
    })
    .catch((error) => notice(`Could not load the model list: ${error.message}`, "error"));
