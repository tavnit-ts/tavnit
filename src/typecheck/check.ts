import type { SourcePosition } from "../lexer/token.js";
import type { ASTNode, IndexAccessNode, MemberAccessNode } from "../parser/ast.js";
import { parse } from "../parser/parse.js";
import { parseTextTemplate, positionInSource, type TextTemplateExpression, type TextTemplateNode } from "../parser/text-template.js";
import { BUILTIN_SIGNATURES } from "./builtins.js";
import {
  arrayOf,
  asNonEmpty,
  BOOLEAN,
  formatType,
  includesNull,
  membersOf,
  NULL,
  NUMBER,
  nullable,
  objectOf,
  STRING,
  type TavType,
  UNKNOWN,
  unionOf,
  withoutNull,
} from "./types.js";

/** Stable codes of the findings the type checker raises. */
export const TAVNIT_TYPE_CODE = {
  /** A plain read of an optional property: the key can be absent, and the strict evaluator throws. */
  absentProperty: "TAV101",
  /** A `.` or `[]` on a value that can be `null`. */
  nullReceiver: "TAV102",
  /** A name the environment does not declare (only in a closed environment). */
  unknownName: "TAV103",
  /** A read of a property a closed object does not declare. */
  undeclaredProperty: "TAV104",
  /** A read of a property an open object does not declare: the contract does not decide it. */
  openProperty: "TAV105",
  /** A built-in whose first argument rejects `null` receives a value that can be `null`. */
  nullArgument: "TAV106",
  /** A property read on a string, number, boolean or array. */
  notAnObject: "TAV107",
  /** An object or array subscript that can be `null`. */
  nullKey: "TAV108",
  /** A read of a property the contract leaves undecided (presence unknown). */
  unknownPresence: "TAV109",
  /** `a ?? b` where `a` is never `null`: the fallback is dead. Raised only when `redundancy` is on. */
  redundantCoalesce: "TAV201",
  /** `a ?? b` where `a` is always `null`: the left side is dead. */
  nullCoalesce: "TAV202",
  /** `x == null` or `x != null` where `x` is never `null` (or always is): the answer is fixed. */
  constantNullTest: "TAV203",
  /** A condition whose type decides it: an array or object is always truthy, `null` never is. */
  constantCondition: "TAV204",
  /** A comparison with a literal that a schema type excludes. */
  constantComparison: "TAV205",
} as const;

export type TavnitTypeCode = (typeof TAVNIT_TYPE_CODE)[keyof typeof TAVNIT_TYPE_CODE];

/** A span of an expression, in the expression's own 1-based line and column. */
export interface ExpressionSpan {
  start: SourcePosition;
  end: SourcePosition;
}

/** Where a redundant `??` sits, for a fix that removes its fallback: the operands' spans in the expression's own positions. */
export interface CoalesceFix {
  /** Index of the expression among the `${{ }}` spans of the template (0 for a lone expression). */
  expression: number;
  left: ExpressionSpan;
  right: ExpressionSpan;
}

/** One finding of the type checker, with the positions of the node it points at. */
export interface TypeFinding {
  code: TavnitTypeCode;
  /** An error is an operation that throws for a value the contract permits; a warning is one the contract does not decide. */
  severity: "error" | "warning";
  message: string;
  start: SourcePosition;
  end: SourcePosition;
  /** The access path of the receiver, such as `args.client.address`. */
  access?: string;
  /** The inferred type of the receiver. */
  receiverType?: string;
  /** A rewrite that removes the finding. */
  hint?: string;
  /** Present on `TAV201`: the operands of the `??` whose fallback an automatic fix removes. */
  dropFallback?: CoalesceFix;
}

/** A host function the expression can call, with the type of its result. */
export interface HostFunctionType {
  result: TavType;
}

export interface TypeEnvironment {
  /** The types of the names an expression can read. */
  names: Readonly<Record<string, TavType>>;
  /** Host functions by name. A built-in of the same name wins, as in the evaluator. */
  functions?: Readonly<Record<string, HostFunctionType>>;
  /** Report a name missing from `names` (`TAV103`). Default: false, the name has an unknown type. */
  closed?: boolean;
  /**
   * Conditions the host knows to hold (or not) where the expression runs, such as the `if:` of the step
   * that evaluates it. Each narrows the paths it reads, as a ternary condition narrows its branches.
   */
  assume?: readonly TypeAssumption[];
  /**
   * Also report the redundancy findings `TAV201`–`TAV204`: a test or fallback the types already decide.
   * Default: false, so a host that wants only the findings that throw gets only those.
   */
  redundancy?: boolean;
}

/** A condition the expression runs under. */
export interface TypeAssumption {
  condition: ASTNode;
  /** `true` when the condition holds, `false` when it does not (an `unless:`). */
  truthy: boolean;
}

interface Scope {
  names: ReadonlyMap<string, TavType>;
  /** Paths whose type a guard refined: a read of one never throws and has exactly this type. */
  narrowed: ReadonlyMap<string, TavType>;
  collections: ReadonlyMap<string, { kind: "size" | "first"; path: string; source: Lookup; nonNullableElement: boolean }>;
}

type Lookup = Extract<ASTNode, { kind: "identifier" | "member" | "index" }>;

const isLookup = (node: ASTNode): node is Lookup => node.kind === "identifier" || node.kind === "member" || node.kind === "index";

/** `a`, `a.b`, `a["k"]`; undefined for anything a guard cannot name. */
function pathOf(node: ASTNode): string | undefined {
  switch (node.kind) {
    case "identifier": return node.name;
    case "member": {
      const object = pathOf(node.object);
      return object === undefined ? undefined : `${object}.${node.property}`;
    }
    case "index": {
      const object = pathOf(node.object);
      return object !== undefined && node.key.kind === "literal" && typeof node.key.value === "string"
        ? `${object}.${node.key.value}`
        : undefined;
    }
    default: return undefined;
  }
}

/** How a diagnostic names a value: its path, or `value` when it has none. */
const describe = (node: ASTNode): string => pathOf(node) ?? "value";

/** `type(x)` or `x | type` on a lookup, tested against a string literal: the subject and the kind. */
function typeTest(call: ASTNode, literal: ASTNode): { subject: ASTNode; kind: string } | undefined {
  if (literal.kind !== "literal" || typeof literal.value !== "string") return undefined;
  const subject = call.kind === "call" && call.callee === "type" && call.args.length === 1 ? call.args[0]
    : call.kind === "pipe" && call.callee === "type" && call.args.length === 0 ? call.left : undefined;
  return subject !== undefined && isLookup(subject) ? { subject, kind: literal.value } : undefined;
}

const rootOf = (path: string): string => path.split(".")[0];

function flipComparison(op: string): string {
  /* v8 ignore next -- @preserve: callers pass only the four relational operators */
  return ({ "<": ">", "<=": ">=", ">": "<", ">=": "<=" } as Readonly<Record<string, string>>)[op] ?? op;
}

function compareNumbers(left: number, right: number, op: string): boolean {
  if (op === "<") return left < right;
  if (op === "<=") return left <= right;
  if (op === ">") return left > right;
  return left >= right;
}

class Checker {
  readonly findings: TypeFinding[] = [];
  private quiet = 0;

  constructor(private readonly environment: TypeEnvironment) {}

  run(root: ASTNode): void {
    let scope: Scope = { names: new Map(Object.entries(this.environment.names)), narrowed: new Map(), collections: new Map() };
    for (const { condition, truthy } of this.environment.assume ?? []) scope = this.narrow(scope, condition, truthy);
    this.infer(root, scope, false);
  }

  private report(finding: TypeFinding): void {
    if (this.quiet === 0) this.findings.push(finding);
  }

  /** Type `node` without raising findings: the work of a guard. */
  private silently(node: ASTNode, scope: Scope, lenient: boolean): TavType {
    this.quiet++;
    try {
      return this.infer(node, scope, lenient);
    } finally {
      this.quiet--;
    }
  }

  /**
   * `lenient` is the evaluator's lenient read: the left side of `??` and the receiver chain of `?.` read an
   * absent key or name as `null` instead of throwing. It reaches only a lookup chain, never an argument.
   */
  private infer(node: ASTNode, scope: Scope, lenient: boolean): TavType {
    switch (node.kind) {
      case "literal":
        if (node.value === null) return NULL;
        if (typeof node.value === "boolean") return BOOLEAN;
        return typeof node.value === "number" ? NUMBER : STRING;
      case "identifier": return this.inferIdentifier(node, scope, lenient);
      case "array": return arrayOf(unionOf(node.elements.map((element) => this.infer(element, scope, false))), node.elements.length > 0);
      case "object": {
        const properties = Object.fromEntries(node.entries.map(([key, value]) =>
          [key, { type: this.infer(value, scope, false), presence: "required" as const }]));
        return objectOf(properties, false);
      }
      /* v8 ignore next -- @preserve: only parseValueTemplate produces this node, never parse() */
      case "valueTemplate": return UNKNOWN;
      case "unary":
        if (node.op === "-") this.infer(node.operand, scope, false);
        else this.inferCondition(node.operand, scope);
        return node.op === "-" ? NUMBER : BOOLEAN;
      case "binary": return this.inferBinary(node, scope, lenient);
      case "member": return this.inferMember(node, scope, lenient);
      case "index": return this.inferIndex(node, scope, lenient);
      case "call": return this.inferCall(node.callee, node.args.map((argument) => ({ node: argument })), scope);
      case "pipe": {
        const left = { node: node.left };
        return this.inferCall(node.callee, [left, ...node.args.map((argument) => ({ node: argument }))], scope);
      }
      case "ternary": {
        this.inferCondition(node.condition, scope);
        return unionOf([
          this.infer(node.consequent, this.narrow(scope, node.condition, true), false),
          this.infer(node.alternate, this.narrow(scope, node.condition, false), false),
        ]);
      }
      case "arrow": return this.inferArrow(node, scope, []);
      case "let": {
        let inner = scope;
        for (const [name, value] of node.bindings) inner = this.bind(inner, name, this.infer(value, inner, false), value);
        return this.infer(node.body, inner, false);
      }
    }
  }

  private bind(scope: Scope, name: string, type: TavType, value?: ASTNode): Scope {
    const names = new Map(scope.names).set(name, type);
    const narrowed = new Map([...scope.narrowed].filter(([path]) => rootOf(path) !== name));
    const collections = new Map([...scope.collections].filter(([, relation]) => rootOf(relation.path) !== name));
    collections.delete(name);
    const kind = value?.kind === "call" && (value.callee === "size" || value.callee === "first") ? value.callee
      : value?.kind === "pipe" && (value.callee === "size" || value.callee === "first") ? value.callee : undefined;
    const source = value?.kind === "call" ? value.args[0] : value?.kind === "pipe" ? value.left : undefined;
    const path = source === undefined ? undefined : pathOf(source);
    if (kind !== undefined && path !== undefined && source !== undefined && isLookup(source)) {
      const array = this.silently(source, scope, false);
      const members = membersOf(array);
      const nonNullableElement = members.length > 0 && members.every((member) => member.kind === "array" && !includesNull(member.element));
      collections.set(name, { kind, path, source, nonNullableElement });
    }
    return { names, narrowed, collections };
  }

  private inferArrow(node: Extract<ASTNode, { kind: "arrow" }>, scope: Scope, parameters: readonly TavType[]): TavType {
    let inner = scope;
    node.params.forEach((name, index) => { inner = this.bind(inner, name, parameters[index] ?? UNKNOWN); });
    return { kind: "function", result: this.infer(node.body, inner, false) };
  }

  private inferIdentifier(node: Extract<ASTNode, { kind: "identifier" }>, scope: Scope, lenient: boolean): TavType {
    const narrowed = scope.narrowed.get(node.name);
    if (narrowed !== undefined) return narrowed;
    const type = scope.names.get(node.name);
    if (type !== undefined) return type;
    if (this.environment.closed === true && !lenient) {
      this.report({
        code: TAVNIT_TYPE_CODE.unknownName,
        severity: "error",
        message: `Unknown name '${node.name}'.`,
        start: node.start,
        end: node.end,
        access: node.name,
      });
    }
    return UNKNOWN;
  }

  private inferBinary(node: Extract<ASTNode, { kind: "binary" }>, scope: Scope, lenient: boolean): TavType {
    switch (node.op) {
      case "??": {
        const left = this.infer(node.left, scope, isLookup(node.left));
        const right = this.infer(node.right, scope, lenient);
        this.checkCoalesce(node, left);
        return includesNull(left) || left.kind === "unknown" ? unionOf([withoutNull(left), right]) : left;
      }
      case "&&": {
        const left = this.inferCondition(node.left, scope);
        return unionOf([left, this.infer(node.right, this.narrow(scope, node.left, true), false)]);
      }
      case "||": {
        const left = this.inferCondition(node.left, scope);
        return unionOf([left, this.infer(node.right, this.narrow(scope, node.left, false), false)]);
      }
      case "+": {
        const left = this.infer(node.left, scope, false);
        const right = this.infer(node.right, scope, false);
        return (left.kind === "number" || left.kind === "literal" && typeof left.value === "number") &&
          (right.kind === "number" || right.kind === "literal" && typeof right.value === "number") ? NUMBER : UNKNOWN;
      }
      case "-": case "*": case "**": case "/": case "%":
        this.infer(node.left, scope, false);
        this.infer(node.right, scope, false);
        return NUMBER;
      case "==": case "!=": {
        const before = this.findings.length;
        const left = this.infer(node.left, scope, false);
        const right = this.infer(node.right, scope, false);
        this.checkNullTest(node, left, right, before);
        this.checkLiteralComparison(node, left, right, before);
        return BOOLEAN;
      }
      default:
        {
          const before = this.findings.length;
          const left = this.infer(node.left, scope, false);
          const right = this.infer(node.right, scope, false);
          this.checkLiteralComparison(node, left, right, before);
        }
        return BOOLEAN;
    }
  }

  private redundancy(): boolean {
    return this.environment.redundancy === true;
  }

  /** A warning on `node`; `subject` is the value it is about, named in `access`. */
  private warn(
    code: TavnitTypeCode,
    node: ASTNode,
    subject: ASTNode,
    message: string,
    hint?: string,
    receiverType?: TavType,
    dropFallback?: CoalesceFix,
  ): void {
    const access = pathOf(subject);
    this.report({
      code,
      severity: "warning",
      message,
      start: node.start,
      end: node.end,
      ...(access === undefined ? {} : { access }),
      ...(receiverType === undefined ? {} : { receiverType: formatType(receiverType) }),
      ...(hint === undefined ? {} : { hint }),
      ...(dropFallback === undefined ? {} : { dropFallback }),
    });
  }

  /** `a ?? b`: the fallback is dead when `a` is never null, and `a` is dead when it always is. */
  private checkCoalesce(node: Extract<ASTNode, { kind: "binary" }>, left: TavType): void {
    if (!this.redundancy()) return;
    if (left.kind === "null") {
      this.warn(TAVNIT_TYPE_CODE.nullCoalesce, node.left, node.left, `'${describe(node.left)}' is always null, so '??' always takes the right side.`);
    } else if (left.kind !== "unknown" && !includesNull(left)) {
      this.warn(
        TAVNIT_TYPE_CODE.redundantCoalesce,
        node.right,
        node.left,
        `'${describe(node.left)}' is ${formatType(left)} and is never null, so the '??' fallback is never taken.`,
        describe(node.left),
        left,
        {
          expression: 0,
          left: { start: node.left.start, end: node.left.end },
          right: { start: node.right.start, end: node.right.end },
        },
      );
    }
  }

  /** `x == null` / `x != null` on a type that decides it. A read that already raised a finding says nothing more. */
  private checkNullTest(node: Extract<ASTNode, { kind: "binary" }>, left: TavType, right: TavType, before: number): void {
    if (!this.redundancy() || this.findings.length > before) return;
    const nullLeft = node.left.kind === "literal" && node.left.value === null;
    const nullRight = node.right.kind === "literal" && node.right.value === null;
    if (nullLeft === nullRight) return;
    const [subject, type] = nullLeft ? [node.right, right] : [node.left, left];
    if (type.kind === "unknown") return;
    const always = type.kind === "null";
    if (!always && includesNull(type)) return;
    const holds = (node.op === "==") === always;
    this.warn(
      TAVNIT_TYPE_CODE.constantNullTest,
      node,
      subject,
      always
        ? `'${describe(subject)}' is always null, so this comparison is always ${holds}.`
        : `'${describe(subject)}' is ${formatType(type)} and is never null, so this comparison is always ${holds}.`,
      undefined,
      type,
    );
  }

  private checkLiteralComparison(node: Extract<ASTNode, { kind: "binary" }>, left: TavType, right: TavType, before: number): void {
    if (!this.redundancy() || this.findings.length > before) return;
    const subject = node.left.kind === "literal" ? node.right : node.left;
    const literal = node.left.kind === "literal" ? node.left : node.right;
    const type = node.left.kind === "literal" ? right : left;
    if (literal.kind !== "literal" || literal.value === null || type.kind === "unknown" || includesNull(type)) return;
    const members = membersOf(type);
    if (!members.every((member) => member.kind === "literal" || member.kind === "number" || member.kind === "string")) return;
    if (!members.some((member) => member.kind === "literal" || member.kind === "number" &&
      (member.minimum !== undefined || member.maximum !== undefined || member.integer) || member.kind === "string" && member.nonEmpty)) return;
    const allowed = members.map((member) => {
      if (member.kind === "literal") return member.value === literal.value;
      if (member.kind === "string") return typeof literal.value === "string" && (!member.nonEmpty || literal.value.length > 0);
      if (typeof literal.value !== "number") return false;
      return (!member.integer || Number.isInteger(literal.value))
        && (member.minimum === undefined || (member.exclusiveMinimum ? literal.value > member.minimum : literal.value >= member.minimum))
        && (member.maximum === undefined || (member.exclusiveMaximum ? literal.value < member.maximum : literal.value <= member.maximum));
    });
    if (!["==", "!="].includes(node.op)) {
      if (typeof literal.value !== "number" || !["<", "<=", ">", ">="].includes(node.op)) return;
      const value = literal.value;
      const outcomes = members.map((member) => {
        if (member.kind === "literal") return typeof member.value === "number" ? compareNumbers(member.value, value, node.left === literal ? flipComparison(node.op) : node.op) : undefined;
        if (member.kind !== "number") return undefined;
        const op = node.left === literal ? flipComparison(node.op) : node.op;
        const lower = member.minimum;
        const upper = member.maximum;
        if (op === "<") return upper !== undefined && (upper < value || upper === value && member.exclusiveMaximum) ? true : lower !== undefined && lower >= value ? false : undefined;
        if (op === "<=") return upper !== undefined && upper <= value ? true : lower !== undefined && (lower > value || lower === value && member.exclusiveMinimum) ? false : undefined;
        if (op === ">") return lower !== undefined && (lower > value || lower === value && member.exclusiveMinimum) ? true : upper !== undefined && upper <= value ? false : undefined;
        return lower !== undefined && lower >= value ? true : upper !== undefined && (upper < value || upper === value && member.exclusiveMaximum) ? false : undefined;
      });
      if (outcomes.length > 0 && outcomes.every((outcome) => outcome !== undefined && outcome === outcomes[0]))
        this.warn(TAVNIT_TYPE_CODE.constantComparison, node, subject, `'${describe(subject)}' is ${formatType(type)}, so this comparison is always ${outcomes[0]}.`, undefined, type);
      return;
    }
    if (allowed.every(Boolean) && members.every((member) => member.kind === "literal")) {
      this.warn(TAVNIT_TYPE_CODE.constantComparison, node, subject,
        `'${describe(subject)}' is ${formatType(type)}, so this comparison is always ${node.op === "=="}.`, undefined, type);
      return;
    }
    if (allowed.some(Boolean)) return;
    this.warn(TAVNIT_TYPE_CODE.constantComparison, node, subject,
      `'${describe(subject)}' is ${formatType(type)}, so this comparison is always ${node.op === "!="}.`, undefined, type);
  }

  /** Infer a condition (a ternary test, an operand of `&&`, `||` or `!`) and report one its type decides. */
  private inferCondition(node: ASTNode, scope: Scope): TavType {
    const before = this.findings.length;
    const type = this.infer(node, scope, false);
    if (!this.redundancy() || this.findings.length > before) return type;
    const members = membersOf(type);
    const kinds = new Set(members.map((member) => (member.kind === "null" ? false : member.kind === "unknown" ? undefined
      : member.kind === "array" || member.kind === "object" || member.kind === "function" ? true : undefined)));
    if (kinds.size !== 1) return type;
    const [truthy] = kinds;
    if (truthy === undefined) return type;
    const subject = describe(node);
    const array = members.every((member) => member.kind === "array");
    const object = members.every((member) => member.kind === "object");
    this.warn(
      TAVNIT_TYPE_CODE.constantCondition,
      node,
      node,
      truthy
        ? `'${subject}' is ${formatType(type)}, which is always truthy${array || object ? ", even when empty" : ""}, so this condition never varies.`
        : `'${subject}' is always null, so this condition is always false.`,
      array && truthy ? `size(${subject}) > 0` : undefined,
      type,
    );
    return type;
  }

  /** The receiver of an access: lenient when the access is optional or the chain already is, and only for a lookup. */
  private receiver(object: ASTNode, optional: boolean, scope: Scope, lenient: boolean): TavType {
    return this.infer(object, scope, isLookup(object) && (optional || lenient));
  }

  private inferMember(node: MemberAccessNode, scope: Scope, lenient: boolean): TavType {
    const path = pathOf(node);
    const narrowed = path === undefined ? undefined : scope.narrowed.get(path);
    if (narrowed !== undefined) return narrowed;
    const receiver = this.receiver(node.object, node.optional, scope, lenient);
    const propertyStart = { line: node.end.line, column: Math.max(1, node.end.column - node.property.length) };
    return this.readProperty(node, receiver, node.property, propertyStart, node.end, node.optional, lenient);
  }

  private inferIndex(node: IndexAccessNode, scope: Scope, lenient: boolean): TavType {
    const path = pathOf(node);
    const narrowed = path === undefined ? undefined : scope.narrowed.get(path);
    if (narrowed !== undefined) return narrowed;
    const receiver = this.receiver(node.object, node.optional, scope, lenient);
    const key = this.infer(node.key, scope, false);
    const keyed = node.key.kind === "literal" && typeof node.key.value === "string" ? node.key.value : undefined;
    if (keyed !== undefined) return this.readProperty(node, receiver, keyed, node.object.end, node.end, node.optional, lenient);

    const target = this.nullCheck(node.object, receiver, "an index", node.object.end, node.end, node.optional, "?.[…]");
    if (includesNull(key) && target.kind !== "unknown" && !node.optional) {
      this.report({
        code: TAVNIT_TYPE_CODE.nullKey,
        severity: "error",
        message: `The subscript '${describe(node.key)}' can be null, and a null key throws.`,
        start: node.key.start,
        end: node.key.end,
        access: describe(node.key),
        receiverType: formatType(key),
        hint: `${describe(node.object)}[${describe(node.key)} ?? ""]`,
      });
    }
    const results = membersOf(target).map((member): TavType => {
      // An index out of range is `null`, so an array read is its element type or `null`.
      if (member.kind === "array") {
        const head = member.nonEmpty === true && node.key.kind === "literal" && node.key.value === 0;
        return head ? member.element : nullable(member.element);
      }
      return UNKNOWN;
    });
    const result = unionOf(results);
    return node.optional ? nullable(result) : result;
  }

  /** Report a `.` or `[]` on a value that can be null; return the receiver without `null`. */
  private nullCheck(
    object: ASTNode,
    receiver: TavType,
    action: string,
    start: SourcePosition,
    end: SourcePosition,
    optional: boolean,
    guarded: string,
  ): TavType {
    if (!includesNull(receiver)) return receiver;
    if (!optional) {
      const path = describe(object);
      this.report({
        code: TAVNIT_TYPE_CODE.nullReceiver,
        severity: "error",
        message: `'${path}' can be null, so ${action} can throw.`,
        start,
        end,
        access: path,
        receiverType: formatType(receiver),
        hint: `${path}${guarded}`,
      });
    }
    return withoutNull(receiver);
  }

  private readProperty(
    node: MemberAccessNode | IndexAccessNode,
    receiver: TavType,
    property: string,
    start: SourcePosition,
    end: SourcePosition,
    optional: boolean,
    lenient: boolean,
  ): TavType {
    const target = this.nullCheck(node.object, receiver, `reading '${property}'`, start, end, optional, `?.${property}`);
    const soft = optional || lenient;
    const objectPath = describe(node.object);
    const results: TavType[] = [];
    for (const member of membersOf(target)) {
      switch (member.kind) {
        case "object": {
          const declared = Object.hasOwn(member.properties, property) ? member.properties[property] : undefined;
          if (declared === undefined) {
            // An open object that declares nothing is free-form: it asserts nothing about its keys.
            if (member.open && Object.keys(member.properties).length === 0) {
              results.push(UNKNOWN);
              break;
            }
            if (soft) {
              results.push(member.open ? UNKNOWN : NULL);
              break;
            }
            if (member.open) {
              this.report({
                code: TAVNIT_TYPE_CODE.openProperty,
                severity: "warning",
                message: `'${objectPath}' does not declare '${property}', so the contract does not say whether it is there.`,
                start,
                end,
                access: objectPath,
                receiverType: formatType(member),
                hint: `${objectPath}?.${property} ?? …`,
              });
              results.push(UNKNOWN);
            } else {
              this.report({
                code: TAVNIT_TYPE_CODE.undeclaredProperty,
                severity: "error",
                message: `'${objectPath}' has no property '${property}'; the key is never present.`,
                start,
                end,
                access: objectPath,
                receiverType: formatType(member),
              });
              results.push(NULL);
            }
            break;
          }
          if (declared.presence === "required") {
            results.push(declared.type);
          } else if (soft) {
            results.push(nullable(declared.type));
          } else {
            const optionalProperty = declared.presence === "optional";
            this.report({
              code: optionalProperty ? TAVNIT_TYPE_CODE.absentProperty : TAVNIT_TYPE_CODE.unknownPresence,
              severity: optionalProperty ? "error" : "warning",
              message: optionalProperty
                ? `'${objectPath}.${property}' is optional: the key can be absent, and a plain read of an absent key throws.`
                : `'${objectPath}.${property}' is not declared required, so the contract does not say whether the key is there.`,
              start,
              end,
              access: objectPath,
              receiverType: formatType(member),
              hint: `${objectPath}?.${property}`,
            });
            results.push(declared.type);
          }
          break;
        }
        case "array":
        case "string":
        case "number":
        case "boolean":
        case "literal": {
          if (soft) {
            results.push(NULL);
            break;
          }
          // A union such as `string | object` is told apart by a `type()` test the checker does not follow yet.
          if (membersOf(target).length > 1) {
            results.push(UNKNOWN);
            break;
          }
          const what = member.kind === "array" ? "an array" : member.kind === "literal" ? formatType(member) : `a ${member.kind}`;
          this.report({
            code: TAVNIT_TYPE_CODE.notAnObject,
            severity: "error",
            message: `'${objectPath}' is ${what} and has no property '${property}'.`,
            start,
            end,
            access: objectPath,
            receiverType: formatType(member),
          });
          results.push(UNKNOWN);
          break;
        }
        default:
          results.push(UNKNOWN);
      }
    }
    const result = unionOf(results);
    return optional ? nullable(result) : result;
  }

  private inferCall(callee: string, args: Array<{ node: ASTNode }>, scope: Scope): TavType {
    const signature = Object.hasOwn(BUILTIN_SIGNATURES, callee) ? BUILTIN_SIGNATURES[callee] : undefined;
    const host = signature === undefined && this.environment.functions !== undefined && Object.hasOwn(this.environment.functions, callee)
      ? this.environment.functions[callee]
      : undefined;
    const types: TavType[] = [];
    for (const [index, argument] of args.entries()) {
      if (argument.node.kind === "arrow" && signature?.callbackIndex === index) {
        const element = types[0] !== undefined && types[0].kind !== "unknown"
          ? unionOf(membersOf(withoutNull(types[0])).map((member) => (member.kind === "array" ? member.element : UNKNOWN)))
          : UNKNOWN;
        types.push(this.inferArrow(argument.node, scope, [element, NUMBER]));
      } else {
        types.push(this.infer(argument.node, scope, false));
      }
    }
    if (signature === undefined) return host?.result ?? UNKNOWN;
    if (signature.rejectsNull === true && types.length > 0 && includesNull(types[0])) {
      const first = args[0].node;
      this.report({
        code: TAVNIT_TYPE_CODE.nullArgument,
        severity: "error",
        message: `${callee}() rejects null, and '${describe(first)}' can be null.`,
        start: first.start,
        end: first.end,
        access: describe(first),
        receiverType: formatType(types[0]),
        hint: `${describe(first)} ?? …`,
      });
    }
    return signature.result(types);
  }

  /** `scope` refined by what `condition` being `assume` tells about the paths it reads. */
  private narrow(scope: Scope, condition: ASTNode, assume: boolean): Scope {
    const entries = this.guard(scope, condition, assume);
    if (entries.length === 0) return scope;
    return { ...scope, narrowed: new Map([...scope.narrowed, ...entries]) };
  }

  private guard(scope: Scope, condition: ASTNode, assume: boolean): Array<[string, TavType]> {
    switch (condition.kind) {
      case "identifier":
      case "member":
      case "index":
        return assume ? this.present(scope, condition) : [];
      case "call": {
        const emptiness = this.emptinessTest(scope, condition, assume);
        if (emptiness.length > 0) return emptiness;
        return assume ? this.presentThroughFallback(scope, condition, "truthy") : [];
      }
      case "pipe": return this.emptinessTest(scope, condition, assume);
      case "unary":
        return condition.op === "-" ? [] : this.guard(scope, condition.operand, !assume);
      case "binary": {
        const sized = this.sizeTest(scope, condition, assume);
        const rest = this.guardBinary(scope, condition, assume);
        return sized.length === 0 ? rest : [...rest, ...sized];
      }
      default: return [];
    }
  }

  private guardBinary(scope: Scope, condition: Extract<ASTNode, { kind: "binary" }>, assume: boolean): Array<[string, TavType]> {
    if (condition.op === "??") return assume ? this.presentThroughFallback(scope, condition, "truthy") : [];
    if (condition.op === "&&" && assume) {
      const left = this.guard(scope, condition.left, true);
      const inner = left.length === 0 ? scope : { ...scope, narrowed: new Map([...scope.narrowed, ...left]) };
      return [...left, ...this.guard(inner, condition.right, true)];
    }
    if (condition.op === "||" && !assume) {
      const left = this.guard(scope, condition.left, false);
      const inner = left.length === 0 ? scope : { ...scope, narrowed: new Map([...scope.narrowed, ...left]) };
      return [...left, ...this.guard(inner, condition.right, false)];
    }
    if ((condition.op === "==" && assume) || (condition.op === "!=" && !assume)) {
      // `type(x) == "array"` holds only for a value of that kind.
      const tested = typeTest(condition.left, condition.right) ?? typeTest(condition.right, condition.left);
      if (tested !== undefined) return this.ofKind(scope, tested.subject, tested.kind);
    }
    if ((condition.op === "==" && !assume) || (condition.op === "!=" && assume)) {
      const [candidate, compared] = isLookup(condition.left) ? [condition.left, condition.right] : [condition.right, condition.left];
      if (isLookup(candidate) && compared.kind === "literal" && compared.value !== null) {
        const path = pathOf(candidate);
        const current = this.silently(candidate, scope, true);
        if (path !== undefined && current.kind === "union" && current.members.every((member) => member.kind === "literal")) {
          const remaining = current.members.filter((member) => member.kind === "literal" && member.value !== compared.value);
          return [[path, unionOf(remaining)]];
        }
      }
      const nonempty = this.nonemptyCollection(scope, condition.left, condition.right);
      if (nonempty.length > 0) return nonempty;
      const firstCoalesced = this.nullFallbackTest(scope, condition.left, condition.right);
      const coalesced = firstCoalesced.length > 0 ? firstCoalesced : this.nullFallbackTest(scope, condition.right, condition.left);
      if (coalesced.length > 0) return coalesced;
      const firstNonEmpty = this.nonEmptyTest(scope, condition.left, condition.right);
      const nonEmpty = firstNonEmpty.length > 0 ? firstNonEmpty : this.nonEmptyTest(scope, condition.right, condition.left);
      if (nonEmpty.length > 0) return nonEmpty;
      // Only a comparison with `null` tells that the other side is there: `x != "a"` holds for a missing `x` too.
      const subject = isLookup(condition.left) && condition.right.kind === "literal" && condition.right.value === null ? condition.left
        : isLookup(condition.right) && condition.left.kind === "literal" && condition.left.value === null ? condition.right : undefined;
      return subject === undefined ? [] : this.present(scope, subject);
    }
    if (condition.op === "==" && assume) {
      // `x == "a"` holds only for a value that is there.
      const [subject, other] = isLookup(condition.left) ? [condition.left, condition.right] : [condition.right, condition.left];
      if (isLookup(subject) && other.kind === "literal" && other.value !== null) {
        const entries = this.present(scope, subject);
        if (entries.length > 0 && membersOf(entries[0][1]).some((member) => member.kind === "literal"))
          entries[0] = [entries[0][0], { kind: "literal", value: other.value }];
        return entries;
      }
      return [];
    }
    if (assume && [">", ">=", "<", "<="].includes(condition.op)) {
      const firstNumeric = this.numericTest(scope, condition.left, condition.right, condition.op);
      const numeric = firstNumeric.length > 0 ? firstNumeric
        : this.numericTest(scope, condition.right, condition.left, condition.op === ">" ? "<" : condition.op === "<" ? ">" : condition.op === ">=" ? "<=" : ">=");
      if (numeric.length > 0) return numeric;
    }
    return [];
  }

  /** `filled(xs)`, `!isEmpty(xs)` and `!blank(xs)`: an array that passes is not empty (and not null). */
  private emptinessTest(scope: Scope, node: Extract<ASTNode, { kind: "call" | "pipe" }>, assume: boolean): Array<[string, TavType]> {
    const subject = node.kind === "call" ? (node.args.length === 1 ? node.args[0] : undefined) : (node.args.length === 0 ? node.left : undefined);
    const nonEmptyWhen = node.callee === "filled" ? true : node.callee === "isEmpty" || node.callee === "blank" ? false : undefined;
    if (subject === undefined || !isLookup(subject) || nonEmptyWhen === undefined || nonEmptyWhen !== assume) return [];
    return this.markNonEmpty(scope, subject);
  }

  /** The lookup `size(xs)` or `xs | size` measures, or the one a `let n = size(xs)` binding recorded for `n`. */
  private sizeSource(scope: Scope, node: ASTNode): Lookup | undefined {
    if (node.kind === "identifier") {
      const relation = scope.collections.get(node.name);
      return relation?.kind === "size" ? relation.source : undefined;
    }
    if (node.kind === "call" && node.callee === "size" && node.args.length === 1 && isLookup(node.args[0])) return node.args[0];
    if (node.kind === "pipe" && node.callee === "size" && node.args.length === 0 && isLookup(node.left)) return node.left;
    return undefined;
  }

  /** A comparison of a size with a number that forces at least one element: `size(xs) > 0`, `n >= 1`, `0 < n`, `n != 0`. */
  private sizeTest(scope: Scope, condition: Extract<ASTNode, { kind: "binary" }>, assume: boolean): Array<[string, TavType]> {
    const flipped: Readonly<Record<string, string>> = { "==": "==", "!=": "!=", ">": "<", ">=": "<=", "<": ">", "<=": ">=" };
    const negated: Readonly<Record<string, string>> = { "==": "!=", "!=": "==", ">": "<=", ">=": "<", "<": ">=", "<=": ">" };
    if (!Object.hasOwn(flipped, condition.op)) return [];
    let source = this.sizeSource(scope, condition.left);
    let limit = condition.right;
    let op: string = condition.op;
    if (source === undefined) {
      source = this.sizeSource(scope, condition.right);
      limit = condition.left;
      op = flipped[op];
    }
    if (source === undefined || limit.kind !== "literal" || typeof limit.value !== "number") return [];
    if (!assume) op = negated[op];
    const k = limit.value;
    const forcesElement = (op === ">" && k >= 0) || (op === ">=" && k >= 1) || (op === "==" && k >= 1) || (op === "!=" && k === 0);
    return forcesElement ? this.markNonEmpty(scope, source) : [];
  }

  /** `subject` is there, and any array it can be holds an element. */
  private markNonEmpty(scope: Scope, subject: Lookup): Array<[string, TavType]> {
    const entries = this.present(scope, subject);
    // A lookup with a variable subscript (`xs[i]`) names no path, so there is nothing to refine.
    if (entries.length > 0) entries[0] = [entries[0][0], asNonEmpty(entries[0][1])];
    return entries;
  }

  private nullFallbackTest(scope: Scope, value: ASTNode, empty: ASTNode): Array<[string, TavType]> {
    if (empty.kind !== "literal" || empty.value !== null || value.kind !== "binary" || value.op !== "??" ||
      value.right.kind !== "literal" || value.right.value !== null || !isLookup(value.left)) return [];
    return this.present(scope, value.left);
  }

  private nonemptyCollection(scope: Scope, left: ASTNode, right: ASTNode): Array<[string, TavType]> {
    const length = left.kind === "identifier" && right.kind === "literal" && right.value === 0 ? left
      : right.kind === "identifier" && left.kind === "literal" && left.value === 0 ? right : undefined;
    if (length === undefined) return [];
    const relation = scope.collections.get(length.name);
    if (relation?.kind !== "size") return [];
    const entries: Array<[string, TavType]> = [];
    for (const [name, first] of scope.collections) {
      if (first.kind !== "first" || !first.nonNullableElement || first.path !== relation.path) continue;
      const type = scope.names.get(name);
      /* v8 ignore next -- @preserve: `bind` sets the name of every collection relation */
      if (type !== undefined) entries.push([name, withoutNull(type)]);
    }
    return entries;
  }

  /** A false fallback cannot produce a truthy result; a successful read of the left path must have occurred. */
  private presentThroughFallback(scope: Scope, node: ASTNode, test: "truthy" | "nonEmpty" | "positive"): Array<[string, TavType]> {
    const operand = node.kind === "call" && node.args.length === 1 &&
      (test === "nonEmpty" && node.callee === "trim" || test === "positive" && node.callee === "num")
      ? node.args[0] : node;
    if (operand.kind !== "binary" || operand.op !== "??" || !isLookup(operand.left) || operand.right.kind !== "literal") return [];
    const fallback = operand.right.value;
    if (test === "truthy" && fallback !== null && fallback !== false && fallback !== 0 && fallback !== "") return [];
    if (test === "nonEmpty" && fallback !== "") return [];
    if (test === "positive" && (typeof fallback !== "number" || fallback > 0)) return [];
    return this.present(scope, operand.left);
  }

  private nonEmptyTest(scope: Scope, value: ASTNode, empty: ASTNode): Array<[string, TavType]> {
    return empty.kind === "literal" && empty.value === "" ? this.presentThroughFallback(scope, value, "nonEmpty") : [];
  }

  private numericTest(scope: Scope, value: ASTNode, threshold: ASTNode, op: string): Array<[string, TavType]> {
    if (threshold.kind !== "literal" || typeof threshold.value !== "number" ||
      !((op === ">" && threshold.value >= 0) || (op === ">=" && threshold.value > 0))) return [];
    return this.presentThroughFallback(scope, value, "positive");
  }

  /** `subject` narrowed to the members of `kind`; a value of any kind but `null` is there. */
  private ofKind(scope: Scope, subject: ASTNode, kind: string): Array<[string, TavType]> {
    const entries = this.present(scope, subject);
    const path = pathOf(subject);
    if (kind === "null" || entries.length === 0 || path === undefined) return kind === "null" ? [] : entries;
    const current = entries[0][1];
    const members = membersOf(current).filter((member) => member.kind === kind);
    entries[0] = [path, members.length === 0 ? current : unionOf(members)];
    return entries;
  }

  /** A lookup that holds a value is non-null, and so is every object on the way to it. */
  private present(scope: Scope, node: ASTNode): Array<[string, TavType]> {
    const entries: Array<[string, TavType]> = [];
    let current: ASTNode = node;
    for (;;) {
      const path = pathOf(current);
      if (path === undefined) break;
      entries.push([path, withoutNull(this.silently(current, scope, true))]);
      if (current.kind === "member" || current.kind === "index") current = current.object;
      else break;
    }
    return entries;
  }
}

/** Check one parsed expression against the types of the names it can read. */
export function checkExpression(node: ASTNode, environment: TypeEnvironment): TypeFinding[] {
  const checker = new Checker(environment);
  checker.run(node);
  return checker.findings;
}

/** Check an expression source. Throws the parser's error for source that does not parse. */
export function checkExpressionSource(source: string, environment: TypeEnvironment): TypeFinding[] {
  return checkExpression(parse(source), environment);
}

/**
 * Check every expression of a text template: the `${{ }}` spans, the conditions of `${% if %}` / `${% elif %}`,
 * the iterable of `${% for %}` and the spans inside each block. A branch body runs under its condition (and the
 * negation of the conditions before it), as a step runs under its `if:`; a `${% for %}` body reads its variable and
 * `forloop` as `unknown`. The positions are template positions (1-based line and column). Inside a block only the
 * findings that throw are reported: `dropFallback` addresses the top-level spans only. A template that does not
 * parse yields no findings; the parser reports it.
 */
export function checkTemplate(template: string, environment: TypeEnvironment): TypeFinding[] {
  let nodes: TextTemplateNode[];
  try {
    nodes = parseTextTemplate(template);
  } catch {
    return [];
  }
  const findings: TypeFinding[] = [];
  let index = -1;
  const check = (expression: TextTemplateExpression, scope: TypeEnvironment, top: boolean): void => {
    if (top) index++;
    for (const finding of checkExpression(expression.node, scope)) {
      if (!top && finding.code.startsWith("TAV2")) continue;
      const { dropFallback, ...rest } = finding;
      findings.push({
        ...rest,
        ...(dropFallback === undefined || !top ? {} : { dropFallback: { ...dropFallback, expression: index } }),
        start: positionInSource(template, expression.offset, finding.start),
        end: positionInSource(template, expression.offset, finding.end),
      });
    }
  };
  const visit = (list: TextTemplateNode[], scope: TypeEnvironment, top: boolean): void => {
    for (const node of list) {
      if (node.kind === "expression") check(node, scope, top);
      else if (node.kind === "if") {
        let before = scope.assume ?? [];
        for (const branch of node.branches) {
          check(branch.condition, { ...scope, assume: before }, false);
          visit(branch.body, { ...scope, assume: [...before, { condition: branch.condition.node, truthy: true }] }, false);
          before = [...before, { condition: branch.condition.node, truthy: false }];
        }
        if (node.alternate) visit(node.alternate, { ...scope, assume: before }, false);
      } else if (node.kind === "for") {
        check(node.iterable, scope, false);
        // The loop binds its variable and `forloop`; a condition about a name it shadows no longer holds inside.
        const shadows = Object.hasOwn(scope.names, node.variable) || Object.hasOwn(scope.names, "forloop");
        visit(node.body, {
          ...scope,
          names: { ...scope.names, [node.variable]: UNKNOWN, forloop: UNKNOWN },
          assume: shadows ? [] : scope.assume,
        }, false);
      }
    }
  };
  visit(nodes, environment, true);
  return findings;
}
