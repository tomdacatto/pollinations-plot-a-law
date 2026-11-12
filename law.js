// A law as data. A model describes a law of nature as a JSON spec (parameters, equations, a few
// worked check points). This file reads that spec, evaluates its equations with a small expression
// parser of its own (no eval, no Function), and runs the model's check points against the result.
// It has no DOM and no network.

export class LawError extends Error {}

const FUNCTIONS = {
    sqrt: Math.sqrt,
    cbrt: Math.cbrt,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    exp: Math.exp,
    ln: Math.log,
    log10: Math.log10,
    abs: Math.abs,
    min: Math.min,
    max: Math.max,
};
const CONSTANTS = { pi: Math.PI, e: Math.E };
export const FUNCTION_NAMES = Object.keys(FUNCTIONS);
const RESERVED = new Set([...Object.keys(FUNCTIONS), ...Object.keys(CONSTANTS)]);

// ---- tokens -------------------------------------------------------------------------------------

const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;

function tokenize(source) {
    const tokens = [];
    let rest = String(source);
    while (rest.length) {
        const space = rest.match(/^\s+/);
        if (space) {
            rest = rest.slice(space[0].length);
            continue;
        }
        const number = rest.match(NUMBER);
        if (number) {
            tokens.push({ type: "num", value: Number(number[0]) });
            rest = rest.slice(number[0].length);
            continue;
        }
        const ident = rest.match(IDENT);
        if (ident) {
            tokens.push({ type: "id", value: ident[0] });
            rest = rest.slice(ident[0].length);
            continue;
        }
        if ("+-*/^(),".includes(rest[0])) {
            tokens.push({ type: "op", value: rest[0] });
            rest = rest.slice(1);
            continue;
        }
        throw new LawError(`Unexpected "${rest[0]}" in "${source}".`);
    }
    return tokens;
}

// ---- parser: expression -> tree -------------------------------------------------------------------
// expr   = term (("+" | "-") term)*
// term   = unary (("*" | "/") unary)*
// unary  = "-" unary | power          (so -2^2 is -4)
// power  = atom ("^" unary)?         (right associative: 2^3^2 is 2^9)
// atom   = number | name | name "(" expr ("," expr)* ")" | "(" expr ")"

export function parse(source) {
    const tokens = tokenize(source);
    let at = 0;
    const peek = () => tokens[at];
    const isOp = (value) => peek()?.type === "op" && peek().value === value;
    const take = () => tokens[at++];
    const expect = (value) => {
        if (!isOp(value)) throw new LawError(`Expected "${value}" in "${source}".`);
        at++;
    };

    function expr() {
        let left = term();
        while (isOp("+") || isOp("-")) left = { type: "bin", op: take().value, left, right: term() };
        return left;
    }
    function term() {
        let left = unary();
        while (isOp("*") || isOp("/")) left = { type: "bin", op: take().value, left, right: unary() };
        return left;
    }
    function unary() {
        if (isOp("-")) {
            take();
            return { type: "neg", arg: unary() };
        }
        if (isOp("+")) {
            take();
            return unary();
        }
        return power();
    }
    function power() {
        const base = atom();
        if (isOp("^")) {
            take();
            return { type: "bin", op: "^", left: base, right: unary() };
        }
        return base;
    }
    function atom() {
        const token = take();
        if (!token) throw new LawError(`"${source}" ends too soon.`);
        if (token.type === "num") return { type: "num", value: token.value };
        if (token.type === "id") {
            if (isOp("(")) {
                if (!Object.hasOwn(FUNCTIONS, token.value))
                    throw new LawError(`Unknown function "${token.value}". Allowed: ${FUNCTION_NAMES.join(", ")}.`);
                take();
                const args = [expr()];
                while (isOp(",")) {
                    take();
                    args.push(expr());
                }
                expect(")");
                return { type: "call", name: token.value, args };
            }
            return { type: "var", name: token.value };
        }
        if (token.value === "(") {
            const inner = expr();
            expect(")");
            return inner;
        }
        throw new LawError(`Unexpected "${token.value}" in "${source}".`);
    }

    if (!tokens.length) throw new LawError("An equation is empty.");
    const tree = expr();
    if (at < tokens.length) {
        const left = tokens[at];
        const hint =
            left.type === "num" || left.type === "id" || left.value === "("
                ? ' Write "*" between factors: implicit multiplication is not allowed.'
                : "";
        throw new LawError(`Unexpected "${left.value}" in "${source}".${hint}`);
    }
    return tree;
}

/** The names an expression reads (variables, not functions or constants). */
export function names(tree, found = new Set()) {
    if (tree.type === "var" && !(tree.name in CONSTANTS)) found.add(tree.name);
    for (const child of [tree.left, tree.right, tree.arg, ...(tree.args ?? [])]) if (child) names(child, found);
    return found;
}

/** The value of a parsed expression. `scope` maps names to numbers. */
export function evaluate(tree, scope = {}) {
    switch (tree.type) {
        case "num":
            return tree.value;
        case "var":
            if (Object.hasOwn(CONSTANTS, tree.name)) return CONSTANTS[tree.name];
            if (!Object.hasOwn(scope, tree.name)) throw new LawError(`"${tree.name}" has no value.`);
            return scope[tree.name];
        case "neg":
            return -evaluate(tree.arg, scope);
        case "call":
            return FUNCTIONS[tree.name](...tree.args.map((arg) => evaluate(arg, scope)));
        case "bin": {
            const a = evaluate(tree.left, scope);
            const b = evaluate(tree.right, scope);
            if (tree.op === "+") return a + b;
            if (tree.op === "-") return a - b;
            if (tree.op === "*") return a * b;
            if (tree.op === "/") return a / b;
            return a ** b;
        }
        default:
            throw new LawError("Unknown expression.");
    }
}

// ---- the spec ---------------------------------------------------------------------------------------

const isName = (value) =>
    typeof value === "string" &&
    /^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(value) &&
    !value.startsWith("__") &&
    !RESERVED.has(value);
const isNum = (value) => typeof value === "number" && Number.isFinite(value);
const text = (value, max, what) => {
    if (typeof value !== "string" || !value.trim()) throw new LawError(`${what} is missing.`);
    return value.trim().slice(0, max);
};

/**
 * Checks the model's JSON and returns the spec the app uses, with each equation parsed.
 * Throws a LawError that says what is wrong, so the page can show it.
 */
export function readSpec(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new LawError("The answer is not a JSON object.");
    const title = text(raw.title, 80, "title");
    const explanation = text(raw.explanation, 900, "explanation");

    if (!Array.isArray(raw.parameters) || raw.parameters.length < 1 || raw.parameters.length > 3)
        throw new LawError("parameters must list one to three parameters.");
    const parameters = raw.parameters.map((p, i) => {
        if (!isName(p?.name))
            throw new LawError(
                `Parameter ${i + 1} has no usable name (letters, digits, underscore; not pi, e or a function).`,
            );
        if (![p.min, p.max, p.default].every(isNum) || !(p.min < p.max) || p.default < p.min || p.default > p.max)
            throw new LawError(`Parameter "${p.name}" needs numbers with min < max and default inside the range.`);
        return {
            name: p.name,
            label: text(p.label ?? p.name, 60, "label"),
            unit: String(p.unit ?? "").slice(0, 20),
            min: p.min,
            max: p.max,
            default: p.default,
        };
    });

    const x = raw.x;
    if (!isName(x?.name)) throw new LawError("x has no usable name.");
    if (![x.min, x.max].every(isNum) || !(x.min < x.max)) throw new LawError("x needs numbers with min < max.");
    if (parameters.some((p) => p.name === x.name))
        throw new LawError(`"${x.name}" is both a parameter and the x variable.`);

    if (!Array.isArray(raw.equations) || raw.equations.length < 1 || raw.equations.length > 2)
        throw new LawError("equations must list one or two equations.");
    const known = new Set([x.name, ...parameters.map((p) => p.name)]);
    const equations = raw.equations.map((q, i) => {
        if (!isName(q?.name) || known.has(q.name))
            throw new LawError(
                `Equation ${i + 1} is named "${q?.name}", which is not a usable new name (letters, digits, underscore, up to 32 characters, not already used, not pi, e or a function).`,
            );
        const expression = text(q.expression, 200, `Equation ${i + 1}`);
        const tree = parse(expression);
        for (const used of names(tree))
            if (!known.has(used)) throw new LawError(`"${expression}" uses "${used}", which is not defined.`);
        known.add(q.name);
        return {
            name: q.name,
            expression,
            readable: String(q.readable ?? "")
                .trim()
                .slice(0, 160),
            tree,
        };
    });

    const y = raw.y;
    if (!y || !equations.some((q) => q.name === y.equation))
        throw new LawError("y.equation must name one of the equations.");

    const checks = Array.isArray(raw.checks) ? raw.checks : [];
    if (checks.length < 1 || checks.length > 5) throw new LawError("checks must list one to five worked points.");
    const readChecks = checks.map((c, i) => {
        if (!c || typeof c.at !== "object" || c.at === null || !isNum(c.expect))
            throw new LawError(`Check ${i + 1} needs "at" (values) and a numeric "expect".`);
        if (!isNum(c.at[x.name])) throw new LawError(`Check ${i + 1} gives no value for ${x.name}.`);
        const at = { [x.name]: c.at[x.name] };
        for (const p of parameters) at[p.name] = isNum(c.at[p.name]) ? c.at[p.name] : p.default;
        return {
            at,
            expect: c.expect,
            note: String(c.note ?? "")
                .trim()
                .slice(0, 160),
        };
    });

    const sources = (Array.isArray(raw.sources) ? raw.sources : [])
        .filter((s) => typeof s === "string" && s.trim())
        .map((s) => s.trim().slice(0, 160))
        .slice(0, 4);

    return {
        title,
        explanation,
        parameters,
        x: {
            name: x.name,
            label: String(x.label ?? x.name).slice(0, 60),
            unit: String(x.unit ?? "").slice(0, 20),
            min: x.min,
            max: x.max,
        },
        equations,
        y: {
            equation: y.equation,
            label: String(y.label ?? y.equation).slice(0, 60),
            unit: String(y.unit ?? "").slice(0, 20),
        },
        checks: readChecks,
        sources,
    };
}

/** The plotted quantity at `values` (x and every parameter by name). */
export function valueAt(spec, values) {
    const scope = { ...values };
    for (const q of spec.equations) scope[q.name] = evaluate(q.tree, scope);
    return scope[spec.y.equation];
}

/** The curve over the x range, as [x, y] pairs; points where y is not a finite number are left out. */
export function sample(spec, values, count = 160) {
    const points = [];
    for (let i = 0; i <= count; i++) {
        const x = spec.x.min + ((spec.x.max - spec.x.min) * i) / count;
        const y = valueAt(spec, { ...values, [spec.x.name]: x });
        if (Number.isFinite(y)) points.push([x, y]);
    }
    return points;
}

export const defaults = (spec) => Object.fromEntries(spec.parameters.map((p) => [p.name, p.default]));

/** Two numbers agree when they are within 1% of the larger one; an expected 0 needs a result of 0 up to rounding error. */
export const agrees = (got, expect) => {
    if (!Number.isFinite(got)) return false;
    if (expect === 0) return Math.abs(got) <= 1e-9;
    return Math.abs(got - expect) <= 0.01 * Math.max(Math.abs(got), Math.abs(expect));
};

/** Runs every check point of the spec: what the equations give where the model said what it would be. */
export function runChecks(spec) {
    return spec.checks.map((check) => {
        const got = valueAt(spec, check.at);
        return { ...check, got, ok: agrees(got, check.expect) };
    });
}

/** The expression of the plotted equation, with earlier equations left as names, for showing next to the model's own writing. */
export const computed = (spec) => spec.equations.map((q) => `${q.name} = ${q.expression}`);

// ---- JSON out of a reply --------------------------------------------------------------------------------

/** The first JSON object in a reply, which may be fenced or wrapped in words. */
export function parseJson(reply) {
    const fenced = String(reply).match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fenced ? fenced[1] : String(reply);
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end <= start) throw new LawError("The reply has no JSON object in it.");
    try {
        return JSON.parse(body.slice(start, end + 1));
    } catch (error) {
        throw new LawError(`The reply is not valid JSON (${error.message}).`);
    }
}

// ---- prompts ---------------------------------------------------------------------------------------------

export const TOPICS = [
    "Projectile range against launch angle (physics)",
    "Radioactive decay and half-life (physics)",
    "Logistic population growth (biology)",
    "Michaelis-Menten enzyme kinetics (biochemistry)",
    "Pressure of an ideal gas against its volume (chemistry)",
    "Equilibrium temperature of a planet against its albedo (earth science)",
];

const FORMAT = `Reply with one JSON object and nothing else, with exactly these keys:
{
  "title": "short name of the law",
  "explanation": "at most 120 words in plain language: what the law says and what the plot shows",
  "parameters": [ {"name": "g", "label": "gravitational acceleration", "unit": "m/s^2", "min": 1, "max": 25, "default": 9.81} ],
  "x": {"name": "L", "label": "string length", "unit": "m", "min": 0.1, "max": 5},
  "equations": [ {"name": "period", "expression": "2 * pi * sqrt(L / g)", "readable": "T = 2π √(L / g)"} ],
  "y": {"equation": "period", "label": "period", "unit": "s"},
  "checks": [ {"at": {"L": 1, "g": 9.81}, "expect": 2.006, "note": "2π √(1 / 9.81) = 2.006"} ],
  "sources": ["Halliday, Resnick & Walker, Fundamentals of Physics, oscillations chapter"]
}
The example above only shows the format (it is a pendulum). Describe the law you were asked about, with its own names, equations and numbers.
Rules:
- One to three parameters, one x variable, one or two equations. The last equation you list should be the plotted one, or set y.equation to the one you plot.
- An expression may use numbers (1.5e-3), the names you defined, + - * / ^, parentheses, pi, e and these functions: ${FUNCTION_NAMES.join(", ")}. Write * between factors; "2x" is not allowed. Put constants in as numbers. Angles are in radians inside sin, cos and tan.
- Names are letters, digits and underscores (up to 32 characters), start with a letter, and must not be pi, e or a function name. Every name is used once: a parameter, x and each equation have different names.
- An equation may use only the parameters, x, and equations listed before it.
- "checks": exactly three worked points. Work each "expect" out by hand from your own formula, in the plot's units, before you write it. Give a value for x and for every parameter that matters. Choose points that are not all alike.
- "sources": one to three textbook or paper titles you know the law from. Titles and authors only; do not write web addresses.`;

export const specMessages = (topic) => [
    {
        role: "user",
        content: `Describe this law of nature as a plot a reader can explore with sliders: ${topic}\n\n${FORMAT}`,
    },
];

/** One repair round: the model's own spec and the check points its equations missed. */
export function fixMessages(topic, raw, failed) {
    const lines = failed
        .map(
            (c) =>
                `- at ${JSON.stringify(c.at)} you expected ${c.expect}; the equations give ${Number.isFinite(c.got) ? Number(c.got.toPrecision(6)) : String(c.got)}.`,
        )
        .join("\n");
    return [
        {
            role: "user",
            content: `Describe this law of nature as a plot a reader can explore with sliders: ${topic}\n\n${FORMAT}`,
        },
        { role: "assistant", content: JSON.stringify(raw) },
        {
            role: "user",
            content: `A program evaluated your equations at your own check points and these did not match:\n${lines}\nEither an equation or a hand-worked "expect" is wrong. Work out which, fix it (change the equation, the check value, or both), and reply with the corrected JSON object only, in the same format.`,
        },
    ];
}
