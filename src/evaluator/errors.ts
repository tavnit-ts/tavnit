import { type ErrorDetails, EvaluationError, type EvalContext } from "./types.js";

/** Every stable error code, in the order `errors.md` lists them. */
export const ERROR_CODES = [
  "TAV_SYNTAX",
  "TAV_RUNTIME",
  "TAV_TYPE",
  "TAV_NULL_ACCESS",
  "TAV_UNKNOWN_NAME",
  "TAV_UNKNOWN_PROPERTY",
  "TAV_UNKNOWN_FUNCTION",
  "TAV_DIVISION_BY_ZERO",
  "TAV_LIMIT_ITERATIONS",
  "TAV_LIMIT_STEPS",
  "TAV_LIMIT_TIMEOUT",
  "TAV_LIMIT_OUTPUT",
  "TAV_LIMIT_DEPTH",
  "TAV_LIMIT_STRING",
  "TAV_LIMIT_STACK",
  "TAV_CONTEXT",
  "TAV_ASYNC",
  "TAV_ASYNC_REQUIRED",
  "TAV_HOST",
  "TAV_USAGE",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** An `EvaluationError` with a stable code. */
export function codedError(code: ErrorCode, message: string, extra: Omit<ErrorDetails, "code"> = {}): EvaluationError {
  return new EvaluationError(message, undefined, undefined, { code, ...extra });
}

/** The same, attributed to a part of the failing node (`position`). */
export function codedErrorAt(
  code: ErrorCode,
  position: EvaluationError["position"],
  message: string,
  extra: Omit<ErrorDetails, "code"> = {},
): EvaluationError {
  return new EvaluationError(message, position, undefined, { code, ...extra });
}

export type LimitName = "iterations" | "steps" | "timeout" | "output" | "depth" | "string";

const LIMITS: Record<LimitName, { code: ErrorCode; option: string; message: (value: number, subject: string) => string }> = {
  iterations: { code: "TAV_LIMIT_ITERATIONS", option: "maxIterations", message: (value) => `Iteration limit ${value} exceeded; raise maxIterations` },
  steps: { code: "TAV_LIMIT_STEPS", option: "maxSteps", message: (value) => `Step limit ${value} exceeded; raise maxSteps` },
  timeout: { code: "TAV_LIMIT_TIMEOUT", option: "timeoutMs", message: (value) => `Evaluation timed out after ${value} ms; raise timeoutMs` },
  output: { code: "TAV_LIMIT_OUTPUT", option: "maxOutputBytes", message: (value) => `Output size limit of ${value} bytes exceeded; raise maxOutputBytes` },
  depth: { code: "TAV_LIMIT_DEPTH", option: "maxDepth", message: (value) => `Recursion depth limit ${value} exceeded; raise maxDepth` },
  string: { code: "TAV_LIMIT_STRING", option: "maxStringLength", message: (value, subject) => `${subject} exceeds ${value} characters; raise maxStringLength` },
};

/** The error of an exceeded limit: its message names the value and the option that raises it. */
export function limitError(limit: LimitName, value: number, subject = "Result"): EvaluationError {
  const { code, option, message } = LIMITS[limit];
  return new EvaluationError(message(value, subject), undefined, undefined, { code, limit, value, option });
}

/** Spend `n` iterations of the call's budget; throws when it runs out. */
export function chargeIterations(ctx: EvalContext, n: number): void {
  ctx.iterBudget.remaining -= n;
  if (ctx.iterBudget.remaining < 0) throw limitError("iterations", ctx.limits.maxIterations);
}

/** The known name nearest to `name` within a small edit distance, or undefined. */
export function nearest(name: string, candidates: Iterable<string>): string | undefined {
  if (name.length < 3) return undefined;
  const lower = name.toLowerCase();
  const allowed = Math.max(1, Math.floor(name.length / 3));
  let best: string | undefined;
  let bestDistance = allowed + 1;
  for (const candidate of candidates) {
    const distance = editDistance(lower, candidate.toLowerCase(), bestDistance);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Optimal string alignment distance (Levenshtein plus adjacent transposition), or `cap` when it is at least that. */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) >= cap) return cap;
  let beforePrevious: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], beforePrevious[j - 2] + 1);
    }
    beforePrevious = previous;
    previous = row;
  }
  return Math.min(previous[b.length], cap);
}
