import assert from "node:assert/strict";
import test from "node:test";
import {
    agrees,
    defaults,
    evaluate,
    fixMessages,
    LawError,
    names,
    parse,
    parseJson,
    readSpec,
    runChecks,
    sample,
    specMessages,
    valueAt,
} from "./law.js";
import { fmt, ticks } from "./plot.js";

const calc = (source, scope = {}) => evaluate(parse(source), scope);

test("the reader follows the usual order of operations", () => {
    assert.equal(calc("1 + 2 * 3"), 7);
    assert.equal(calc("(1 + 2) * 3"), 9);
    assert.equal(calc("10 - 4 - 3"), 3);
    assert.equal(calc("100 / 10 / 5"), 2);
    assert.equal(calc("2 ^ 3 ^ 2"), 512);
    assert.equal(calc("-2 ^ 2"), -4);
    assert.equal(calc("2 ^ -1"), 0.5);
    assert.equal(calc("--3"), 3);
    assert.equal(calc("1.5e-3 * 2000"), 3);
    assert.equal(calc("5.67e-8 * 1e8"), 5.67);
});

test("it knows its constants and functions and the names it is given", () => {
    assert.ok(Math.abs(calc("sin(pi / 2)") - 1) < 1e-12);
    assert.ok(Math.abs(calc("ln(e)") - 1) < 1e-12);
    assert.equal(calc("sqrt(16) + max(1, 5, 3)"), 9);
    assert.equal(calc("m * v ^ 2 / 2", { m: 2, v: 3 }), 9);
    assert.deepEqual([...names(parse("a * sin(b) + pi + c ^ 2"))].sort(), ["a", "b", "c"]);
});

test("it refuses anything that is not plain arithmetic", () => {
    for (const bad of [
        "",
        "  ",
        "1 +",
        "(1 + 2",
        "1 2",
        "2x",
        "x y",
        "3 (4)",
        "1 ** 2",
        "a.b",
        "sqrt",
        "alert(1)",
        "constructor(1)",
        "toString(2)",
        "1; 2",
        "x = 3",
        "`1`",
        "[1]",
    ]) {
        assert.throws(() => evaluate(parse(bad), { x: 1, y: 1, a: 1, b: 1 }), LawError, bad);
    }
    assert.throws(() => calc("q + 1"), /"q" has no value/);
    assert.throws(() => calc("__proto__ + 1"), LawError);
});

test("it never runs code from an equation", () => {
    globalThis.__ran = false;
    for (const bad of [
        "globalThis.__ran = true",
        "(()=>{globalThis.__ran=true})()",
        "Function('x')()",
        "this",
        "process",
    ]) {
        try {
            evaluate(parse(bad), {});
        } catch {}
    }
    assert.equal(globalThis.__ran, false);
});

const projectile = () => ({
    title: "Projectile range",
    explanation: "A projectile launched at speed v0 and angle theta lands at a range that is greatest at 45 degrees.",
    parameters: [{ name: "v0", label: "launch speed", unit: "m/s", min: 1, max: 100, default: 20 }],
    x: { name: "theta", label: "launch angle", unit: "degrees", min: 0, max: 90 },
    equations: [
        { name: "range", expression: "v0^2 * sin(2 * theta * pi / 180) / 9.81", readable: "R = v0^2 sin(2θ) / g" },
    ],
    y: { equation: "range", label: "range", unit: "m" },
    checks: [
        { at: { theta: 45, v0: 20 }, expect: 40.77, note: "400/9.81" },
        { at: { theta: 30, v0: 10 }, expect: 8.83 },
        { at: { theta: 90, v0: 50 }, expect: 0 },
    ],
    sources: ["Halliday, Resnick & Walker, Fundamentals of Physics", ""],
});

test("a good spec is read, evaluated and its worked examples pass", () => {
    const spec = readSpec(projectile());
    assert.equal(spec.parameters.length, 1);
    assert.deepEqual(spec.sources, ["Halliday, Resnick & Walker, Fundamentals of Physics"]);
    assert.ok(Math.abs(valueAt(spec, { v0: 20, theta: 45 }) - 40.77) < 0.01);
    const results = runChecks(spec);
    assert.deepEqual(
        results.map((r) => r.ok),
        [true, true, true],
    );
    assert.deepEqual(defaults(spec), { v0: 20 });
});

test("a wrong equation or a wrong hand-worked number shows up as a failed check", () => {
    const wrongEquation = projectile();
    wrongEquation.equations[0].expression = "v0^2 * sin(theta * pi / 180) / 9.81"; // forgot the 2
    assert.deepEqual(
        runChecks(readSpec(wrongEquation)).map((r) => r.ok),
        [false, false, false],
    );

    const wrongNumber = projectile();
    wrongNumber.checks[1].expect = 12;
    assert.deepEqual(
        runChecks(readSpec(wrongNumber)).map((r) => r.ok),
        [true, false, true],
    );
});

test("agreement is within one percent of the larger number, and an expected zero allows rounding error only", () => {
    assert.ok(agrees(100, 100.9));
    assert.ok(!agrees(100, 102));
    assert.ok(agrees(0, 0));
    assert.ok(!agrees(0.5, 0));
    assert.ok(agrees(3e-14, 0));
    assert.ok(!agrees(1e-30, 1));
    assert.ok(!agrees(Number.NaN, 1));
    assert.ok(!agrees(Number.POSITIVE_INFINITY, 1));
});

test("a spec with a problem is refused with a message that says what", () => {
    const refused = (change, pattern) => {
        const raw = projectile();
        change(raw);
        assert.throws(
            () => readSpec(raw),
            (error) => error instanceof LawError && pattern.test(error.message),
        );
    };
    refused((r) => (r.parameters = []), /one to three parameters/);
    refused((r) => (r.parameters[0].default = 500), /min < max and default inside/);
    refused((r) => (r.parameters[0].name = "pi"), /usable name/);
    refused((r) => (r.parameters[0].name = "sin"), /usable name/);
    refused((r) => (r.x.name = "v0"), /both a parameter and the x/);
    refused((r) => (r.equations[0].expression = "v0 * foo"), /"foo", which is not defined/);
    refused((r) => (r.equations[0].expression = "v0 x"), /implicit multiplication/);
    refused((r) => (r.equations[0].expression = "evil(v0)"), /Unknown function/);
    refused((r) => (r.equations = []), /one or two equations/);
    refused((r) => (r.equations[0].name = "v0"), /Equation 1 is named "v0"/);
    refused((r) => (r.y.equation = "nope"), /y.equation/);
    refused((r) => (r.checks = []), /one to five/);
    refused((r) => (r.checks[0].at = { v0: 3 }), /no value for theta/);
    refused((r) => (r.checks[0].expect = "40"), /numeric "expect"/);
    refused((r) => (r.title = ""), /title is missing/);
    assert.throws(() => readSpec(null), LawError);
    assert.throws(() => readSpec([]), LawError);
});

test("a check point leaves out a parameter and gets its default; a second equation can use the first", () => {
    const raw = projectile();
    raw.checks[0].at = { theta: 45 };
    raw.equations = [
        { name: "vy", expression: "v0 * sin(theta * pi / 180)" },
        { name: "height", expression: "vy^2 / (2 * 9.81)" },
    ];
    raw.y = { equation: "height", label: "peak height", unit: "m" };
    raw.checks = [{ at: { theta: 90 }, expect: 20.39 }];
    const spec = readSpec(raw);
    assert.deepEqual(spec.checks[0].at, { theta: 90, v0: 20 });
    assert.ok(runChecks(spec)[0].ok);
});

test("sample gives the curve over the x range and leaves out points that are not numbers", () => {
    const spec = readSpec(projectile());
    const points = sample(spec, { v0: 20 }, 90);
    assert.equal(points.length, 91);
    assert.deepEqual(points[0], [0, 0]);
    assert.equal(points[90][0], 90);
    const peak = points.reduce((best, p) => (p[1] > best[1] ? p : best));
    assert.equal(peak[0], 45);

    const inverse = projectile();
    inverse.equations[0].expression = "1 / theta";
    inverse.checks = [{ at: { theta: 2 }, expect: 0.5 }];
    assert.equal(sample(readSpec(inverse), { v0: 20 }, 90).length, 90); // 1/0 is left out
});

test("the JSON is found in a fenced or wordy reply, and a reply without JSON is an error", () => {
    assert.deepEqual(parseJson('```json\n{"a": 1}\n```'), { a: 1 });
    assert.deepEqual(parseJson('Here you go: {"a": {"b": 2}} Hope that helps.'), { a: { b: 2 } });
    assert.throws(() => parseJson("I cannot do that."), /no JSON object/);
    assert.throws(() => parseJson('{"a": }'), /not valid JSON/);
});

test("the prompts name the allowed functions, and the repair prompt carries the missed check points", () => {
    const first = specMessages("Radioactive decay")[0].content;
    assert.ok(first.includes("Radioactive decay"));
    assert.ok(first.includes("sqrt") && first.includes("log10"));
    assert.ok(first.includes("web addresses"));
    const raw = projectile();
    raw.equations[0].expression = "v0 * 2";
    const spec = readSpec(raw);
    const failed = runChecks(spec).filter((r) => !r.ok);
    const messages = fixMessages("Projectile", raw, failed);
    assert.equal(messages.length, 3);
    assert.equal(messages[1].role, "assistant");
    assert.ok(messages[2].content.includes("you expected 40.77"));
});

test("axis helpers: round ticks and short numbers", () => {
    assert.deepEqual(ticks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
    assert.deepEqual(ticks(0, 1, 5), [0, 0.2, 0.4, 0.6, 0.8, 1]);
    assert.deepEqual(ticks(3, 3), [3]);
    assert.equal(fmt(0), "0");
    assert.equal(fmt(40.7742), "40.77");
    assert.equal(fmt(1234567), "1.23e6");
    assert.equal(fmt(0.00001234), "1.23e-5");
    assert.equal(fmt(Number.NaN), "NaN");
});
