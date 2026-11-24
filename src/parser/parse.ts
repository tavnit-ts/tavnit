import { RESTRICTED } from "../evaluator/restricted.js";
import  { type SourcePosition , type Token, TokenKind } from "../lexer/token.js";
import { LexError, tokenize } from "../lexer/tokenize.js";
import { children } from "./walk.js";
import type {
  ASTNode,
  BinaryOp,
  UnaryOp,
} from "./ast.js";

// ── Error ────────────────────────────────────────────────────────────────────

export class ParseError extends Error {
  readonly start: SourcePosition;
  readonly end: SourcePosition | undefined;

  constructor(message: string, start: SourcePosition, end?: SourcePosition) {
    super(message);
    this.name = "ParseError";
    this.start = start;
    this.end = end;
  }
}

// ── Context flags for ?? / && / || mixing and let…in ────────────────────────

const CTX_NULLISH = 1; // currently assembling a ?? chain
const CTX_LOGICAL = 2; // currently assembling a && / || chain
const CTX_NO_IN   = 4; // inside let…in binding — treat 'in' as non-operator

// ── Binding powers ───────────────────────────────────────────────────────────
//
// Precedence table (the skill's language.md § Precedence Table), highest first:
//   Level 2-3: postfix member/index/call  → lbp 90
//   Level 4:   **   (right-associative)   → lbp 70; a unary operator before ** is an error
//   Level 5:   * / %                      → lbp 60
//   Level 6:   + -                        → lbp 50
//   Level 7:   < > <= >=                  → lbp 40
//   Level 8:   == !=                      → lbp 35
//   Level 9:   in                         → lbp 30
//   Level 10:  && and                     → lbp 25
//   Level 11:  || or                      → lbp 20
//   Level 12:  ??                         → lbp 15
//   Level 13:  ? :  (ternary)             → lbp 10
//   Level 14:  |    (pipe)                → lbp  5
//   Level 15:  =>   (arrow)               → lbp  3
//   Level 16:  let…in                     → nud only (no lbp)

function getLbp(tok: Token): number {
  switch (tok.kind) {
    case TokenKind.StarStar:
      return 70;
    case TokenKind.Star:
    case TokenKind.Slash:
    case TokenKind.Percent:
      return 60;
    case TokenKind.Plus:
    case TokenKind.Minus:
      return 50;
    case TokenKind.Lt:
    case TokenKind.Gt:
    case TokenKind.LtEq:
    case TokenKind.GtEq:
      return 40;
    case TokenKind.Eq:
    case TokenKind.NotEq:
      return 35;
    case TokenKind.In:
      return 30;
    case TokenKind.AmpAmp:
    case TokenKind.And:
      return 25;
    case TokenKind.PipePipe:
    case TokenKind.Or:
      return 20;
    case TokenKind.QuestionQuestion:
      return 15;
    case TokenKind.Question:
      return 10;
    case TokenKind.PipeOp:
      return 5;
    case TokenKind.Arrow:
      return 3;
    // Postfix — these are consumed in the led loop
    case TokenKind.Dot:
    case TokenKind.QuestionDot:
    case TokenKind.LBracket:
    case TokenKind.LParen:
      return 90;
    default:
      return 0;
  }
}

function isLogicalOp(kind: TokenKind): boolean {
  return (
    kind === TokenKind.AmpAmp ||
    kind === TokenKind.And ||
    kind === TokenKind.PipePipe ||
    kind === TokenKind.Or
  );
}

// ── String value parser ──────────────────────────────────────────────────────

function parseStringValue(raw: string): string {
  // raw includes the surrounding quotes ("..." or '...')
  const inner = raw.slice(1, -1);
  let result = "";
  let i = 0;
  while (i < inner.length) {
    if (inner[i] === "\\") {
      i++;
      /* v8 ignore next -- @preserve */
      const esc = inner[i] ?? "";
      switch (esc) {
        case "\\": result += "\\"; break;
        case '"':  result += '"';  break;
        case "'":  result += "'";  break;
        case "n":  result += "\n"; break;
        case "t":  result += "\t"; break;
        case "r":  result += "\r"; break;
        default:   result += `\\${esc}`; break;
      }
    } else {
      result += inner[i];
    }
    i++;
  }
  return result;
}

// ── Parser ───────────────────────────────────────────────────────────────────

/**
 * The called name of a callee node: `fn` for an identifier, `mod.fn` for a plain
 * member chain — a qualified name is a function name like any other. `undefined`
 * for anything else, so a call on a value stays a parse error.
 *
 * An optional member (`mod?.fn`) is not a qualified name: the chain names a
 * function, not a place a value might be.
 */
function dottedCallee(node: ASTNode): string | undefined {
  if (node.kind === "identifier") return node.name;
  if (node.kind === "member" && !node.optional) {
    const object = dottedCallee(node.object);
    return object === undefined ? undefined : `${object}.${node.property}`;
  }
  return undefined;
}

/** The deepest nesting a parsed expression may have, in nodes; fixed so a limit never depends on the stack. */
export const MAX_PARSE_DEPTH = 500;

function tooDeep(start: SourcePosition): ParseError {
  return new ParseError(`Expression nested deeper than ${MAX_PARSE_DEPTH} levels`, start);
}

/** Depth of the tree without recursion: a long left-associative chain is as deep as it is long. */
function checkTreeDepth(root: ASTNode): void {
  const stack: Array<[ASTNode, number]> = [[root, 1]];
  for (let top = stack.pop(); top; top = stack.pop()) {
    const [node, depth] = top;
    if (depth > MAX_PARSE_DEPTH) throw tooDeep(node.start);
    for (const child of children(node)) stack.push([child, depth + 1]);
  }
}

class Parser {
  private readonly tokens: Token[];
  private pos = 0;
  private nesting = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    return this.tokens[this.pos++];
  }

  private expect(kind: TokenKind): Token {
    const tok = this.peek();
    if (tok.kind !== kind) {
      throw new ParseError(
        `Expected ${kind}, got '${tok.value}'`,
        tok.start,
        tok.end,
      );
    }
    return this.consume();
  }

  private err(message: string, start: SourcePosition, end?: SourcePosition): ParseError {
    return new ParseError(message, start, end);
  }

  private unexpected(tok: Token): ParseError {
    return tok.kind === TokenKind.EOF
      ? this.err("Unexpected end of expression", tok.start)
      : this.err(`Unexpected token '${tok.value}'`, tok.start, tok.end);
  }

  private checkReserved(name: string, start: SourcePosition): void {
    if (RESTRICTED.has(name)) {
      throw this.err(`Access to reserved name '${name}' is not allowed`, start);
    }
  }

  // ── Entry point ─────────────────────────────────────────────────────────

  parse(): ASTNode {
    if (this.peek().kind === TokenKind.EOF) {
      throw this.err("Unexpected end of expression", this.peek().start);
    }
    const node = this.parseExpression(0, 0);
    const tok = this.peek();
    if (tok.kind !== TokenKind.EOF) {
      throw this.unexpected(tok);
    }
    checkTreeDepth(node);
    return node;
  }

  // ── Pratt expression parser ─────────────────────────────────────────────

  private parseExpression(minBp: number, ctx: number): ASTNode {
    if (++this.nesting > MAX_PARSE_DEPTH) throw tooDeep(this.peek().start);
    try {
      return this.parsePratt(minBp, ctx);
    } finally {
      this.nesting--;
    }
  }

  private parsePratt(minBp: number, ctx: number): ASTNode {
    let left = this.parsePrimary(ctx);

    let seenNullish = false;
    let seenLogical = false;

    while (true) {
      const tok = this.peek();
      let bp = getLbp(tok);

      // CTX_NO_IN: inside a let…in binding expression, 'in' is not an operator
      if ((ctx & CTX_NO_IN) !== 0 && tok.kind === TokenKind.In) {
        bp = 0;
      }

      if (bp <= minBp) break;

      const tokIsNullish = tok.kind === TokenKind.QuestionQuestion;
      const tokIsLogical = isLogicalOp(tok.kind);

      if (tokIsNullish && (seenLogical || (ctx & CTX_LOGICAL) !== 0)) {
        throw this.err(
          "?? cannot be mixed with && or || without parentheses",
          tok.start,
        );
      }
      if (tokIsLogical && (seenNullish || (ctx & CTX_NULLISH) !== 0)) {
        throw this.err(
          "&& and || cannot be mixed with ?? without parentheses",
          tok.start,
        );
      }

      this.consume();

      if (tokIsNullish) seenNullish = true;
      if (tokIsLogical) seenLogical = true;

      const nextCtx = getNextCtx(tokIsNullish, tokIsLogical);

      left = this.parseLed(left, tok, bp, nextCtx);
    }

    return left;

    function getNextCtx(tokIsNullish: boolean, tokIsLogical: boolean) {
      if (tokIsNullish) {
        return ctx | CTX_NULLISH;
      }
      if (tokIsLogical) {
        return ctx | CTX_LOGICAL;
      }
      return ctx;
    }
  }

  // ── Led (infix / postfix) handlers ─────────────────────────────────────

  private parseLed(left: ASTNode, op: Token, bp: number, ctx: number): ASTNode {
    switch (op.kind) {

      // ── Member access: obj.prop ──────────────────────────────────────
      case TokenKind.Dot: {
        const propTok = this.expect(TokenKind.Identifier);
        this.checkReserved(propTok.value, propTok.start);
        return {
          kind: "member",
          object: left,
          property: propTok.value,
          optional: false,
          start: left.start,
          end: propTok.end,
        };
      }

      // ── Optional chain: obj?.prop  or  obj?.[key] ───────────────────
      case TokenKind.QuestionDot: {
        const next = this.peek();
        if (next.kind === TokenKind.LBracket) {
          this.consume(); // [
          const key = this.parseExpression(0, 0);
          if (key.kind === "literal" && typeof key.value === "string") {
            this.checkReserved(key.value, key.start);
          }
          const close = this.expect(TokenKind.RBracket);
          return {
            kind: "index",
            object: left,
            key,
            optional: true,
            start: left.start,
            end: close.end,
          };
        }
        const propTok = this.expect(TokenKind.Identifier);
        this.checkReserved(propTok.value, propTok.start);
        return {
          kind: "member",
          object: left,
          property: propTok.value,
          optional: true,
          start: left.start,
          end: propTok.end,
        };
      }

      // ── Index access: obj[key] ───────────────────────────────────────
      case TokenKind.LBracket: {
        const key = this.parseExpression(0, 0);
        if (key.kind === "literal" && typeof key.value === "string") {
          this.checkReserved(key.value, key.start);
        }
        const close = this.expect(TokenKind.RBracket);
        return {
          kind: "index",
          object: left,
          key,
          optional: false,
          start: left.start,
          end: close.end,
        };
      }

      // ── Function call: fn(args) ──────────────────────────────────────
      case TokenKind.LParen: {
        const callee = dottedCallee(left);
        if (callee === undefined) {
          throw this.err("Only named functions can be called directly", left.start);
        }
        const args = this.parseArgList();
        const close = this.expect(TokenKind.RParen);
        return {
          kind: "call",
          callee,
          args,
          start: left.start,
          end: close.end,
        };
      }

      // ── Pipe: left | fn  or  left | fn(args) ────────────────────────
      case TokenKind.PipeOp: {
        const calleeTok = this.expect(TokenKind.Identifier);
        let callee = calleeTok.value;
        let end = calleeTok.end;
        // A dotted pipe callee names a function by its qualified name, exactly
        // as the call form does: `items | connection.list`.
        while (this.peek().kind === TokenKind.Dot) {
          this.consume(); // .
          const segment = this.expect(TokenKind.Identifier);
          this.checkReserved(segment.value, segment.start);
          callee += `.${segment.value}`;
          end = segment.end;
        }
        let args: ASTNode[] = [];
        if (this.peek().kind === TokenKind.LParen) {
          this.consume(); // (
          args = this.parseArgList();
          const close = this.expect(TokenKind.RParen);
          end = close.end;
        }
        return {
          kind: "pipe",
          left,
          callee,
          args,
          calleeStart: calleeTok.start,
          start: left.start,
          end,
        };
      }

      // ── Ternary: condition ? consequent : alternate ──────────────────
      case TokenKind.Question: {
        const consequent = this.parseExpression(0, 0);
        this.expect(TokenKind.Colon);
        // Right-associative: rbp = bp - 1
        const alternate = this.parseExpression(bp - 1, 0);
        return {
          kind: "ternary",
          condition: left,
          consequent,
          alternate,
          start: left.start,
          end: alternate.end,
        };
      }

      // ── Arrow: param => body (single unparenthesised param) ─────────
      case TokenKind.Arrow: {
        if (left.kind !== "identifier") {
          throw this.err(
            "Arrow function parameter must be a plain identifier",
            left.start,
          );
        }
        this.checkReserved(left.name, left.start);
        // Right-associative: rbp = bp - 1 = 2; body absorbs pipe and lower.
        // Propagate ctx (e.g. CTX_NO_IN) so 'in' inside an arrow body that
        // appears in a let…in binding expression is still treated as the
        // let separator, not as a binary membership operator.
        const body = this.parseExpression(2, ctx);
        return {
          kind: "arrow",
          params: [left.name],
          body,
          start: left.start,
          end: body.end,
        };
      }

      // ── Binary operators ─────────────────────────────────────────────
      default: {
        const binaryOp = toBinaryOp(op);
        // `**` is right-associative: its right operand binds at one below its own power.
        const right = this.parseExpression(op.kind === TokenKind.StarStar ? bp - 1 : bp, ctx);
        return {
          kind: "binary",
          op: binaryOp,
          left,
          right,
          start: left.start,
          end: right.end,
        };
      }
    }
  }

  // ── Primary (nud) parser ────────────────────────────────────────────────

  private parsePrimary(ctx = 0): ASTNode {
    const tok = this.peek();

    switch (tok.kind) {

      case TokenKind.Number: {
        this.consume();
        const value = Number(tok.value);
        if (!Number.isFinite(value)) {
          throw this.err("Number literal is too large", tok.start, tok.end);
        }
        return { kind: "literal", value, start: tok.start, end: tok.end };
      }

      case TokenKind.String: {
        this.consume();
        return { kind: "literal", value: parseStringValue(tok.value), start: tok.start, end: tok.end };
      }

      case TokenKind.True: {
        this.consume();
        return { kind: "literal", value: true, start: tok.start, end: tok.end };
      }

      case TokenKind.False: {
        this.consume();
        return { kind: "literal", value: false, start: tok.start, end: tok.end };
      }

      case TokenKind.Null: {
        this.consume();
        return { kind: "literal", value: null, start: tok.start, end: tok.end };
      }

      case TokenKind.Identifier: {
        this.consume();
        return { kind: "identifier", name: tok.value, start: tok.start, end: tok.end };
      }

      // ── let … in ────────────────────────────────────────────────────
      case TokenKind.Let: {
        this.consume(); // let
        const bindings: [string, ASTNode][] = [];

        const firstName = this.expect(TokenKind.Identifier);
        this.checkReserved(firstName.value, firstName.start);
        this.expect(TokenKind.Assign);
        // Use CTX_NO_IN so the binding expression stops at 'in'
        bindings.push([firstName.value, this.parseExpression(0, CTX_NO_IN)]);

        while (this.peek().kind === TokenKind.Comma) {
          this.consume(); // ,
          const nameTok = this.expect(TokenKind.Identifier);
          this.checkReserved(nameTok.value, nameTok.start);
          this.expect(TokenKind.Assign);
          bindings.push([nameTok.value, this.parseExpression(0, CTX_NO_IN)]);
        }

        this.expect(TokenKind.In);
        const body = this.parseExpression(0, 0);

        return { kind: "let", bindings, body, start: tok.start, end: body.end };
      }

      // ── Grouping / arrow params ──────────────────────────────────────
      case TokenKind.LParen: {
        this.consume(); // (

        // Empty parens: () => body — the only valid use of ()
        if (this.peek().kind === TokenKind.RParen) {
          const close = this.consume();
          if (this.peek().kind !== TokenKind.Arrow) {
            throw this.err(
              "Empty parentheses '()' are only valid before '=>'",
              tok.start,
              close.end,
            );
          }
          this.consume(); // =>
          // Propagate ctx (e.g. CTX_NO_IN) into the arrow body
          const body = this.parseExpression(2, ctx);
          return { kind: "arrow", params: [], body, start: tok.start, end: body.end };
        }

        // If next token is an identifier, this might be (x) or (x, y, ...) => arrow params
        if (this.peek().kind === TokenKind.Identifier) {
          const savedPos = this.pos;
          const arrowParams = this.tryParseArrowParamList();
          if (arrowParams !== null && this.peek().kind === TokenKind.Arrow) {
            this.consume(); // =>
            // Validate reserved names now that we know it's an arrow
            for (const { name, start } of arrowParams) {
              this.checkReserved(name, start);
            }
            // Propagate ctx (e.g. CTX_NO_IN) into the arrow body
            const body = this.parseExpression(2, ctx);
            return {
              kind: "arrow",
              params: arrowParams.map((p) => p.name),
              body,
              start: tok.start,
              end: body.end,
            };
          }
          // Not an arrow — restore and fall through to regular grouping
          this.pos = savedPos;
        }

        // Regular grouping: (expr)
        const expr = this.parseExpression(0, 0);
        this.expect(TokenKind.RParen);
        return expr;
      }

      // Array literal: [elem, ...]
      case TokenKind.LBracket: {
        this.consume();
        const elements: ASTNode[] = [];
        while (this.peek().kind !== TokenKind.RBracket) {
          if (this.peek().kind === TokenKind.EOF) {
            throw this.err("Unterminated array literal", tok.start);
          }
          if (elements.length > 0) this.expect(TokenKind.Comma);
          if (this.peek().kind === TokenKind.RBracket) break;
          elements.push(this.parseExpression(0, 0));
        }
        const close = this.expect(TokenKind.RBracket);
        return { kind: "array", elements, start: tok.start, end: close.end };
      }

      // Object literal: { key: expr, ... } or { "key": expr, ... }
      case TokenKind.LBrace: {
        this.consume();
        const entries: [string, ASTNode][] = [];
        while (this.peek().kind !== TokenKind.RBrace) {
          if (this.peek().kind === TokenKind.EOF) {
            throw this.err("Unterminated object literal", tok.start);
          }
          if (entries.length > 0) this.expect(TokenKind.Comma);
          if (this.peek().kind === TokenKind.RBrace) break;
          const nextKind = this.peek().kind;
          let key: string;
          if (nextKind === TokenKind.Identifier) {
            key = this.consume().value;
          } else {
            const keyTok = this.expect(TokenKind.String);
            key = parseStringValue(keyTok.value);
          }
          this.expect(TokenKind.Colon);
          const value = this.parseExpression(0, 0);
          entries.push([key, value]);
        }
        const close = this.expect(TokenKind.RBrace);
        return { kind: "object", entries, start: tok.start, end: close.end };
      }

      // Unary !
      case TokenKind.Bang: {
        this.consume();
        const operand = this.parseExpression(80, 0);
        this.rejectPowerOperand("!");
        return { kind: "unary", op: "!" as UnaryOp, operand, start: tok.start, end: operand.end };
      }

      // Unary not
      case TokenKind.Not: {
        this.consume();
        const operand = this.parseExpression(80, 0);
        this.rejectPowerOperand("not");
        return { kind: "unary", op: "not" as UnaryOp, operand, start: tok.start, end: operand.end };
      }

      // Unary -: its operand takes neither `**` nor `*`, so -a * b is (-a) * b; `-a ** b` is a
      // parse error, as in JavaScript (see rejectPowerOperand).
      case TokenKind.Minus: {
        this.consume();
        const operand = this.parseExpression(75, 0);
        this.rejectPowerOperand("-");
        return { kind: "unary", op: "-" as UnaryOp, operand, start: tok.start, end: operand.end };
      }

      default:
        throw this.unexpected(tok);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  /** `-a ** b` is ambiguous, so it is an error (as in JavaScript): the writer chooses `(-a) ** b` or `-(a ** b)`. */
  private rejectPowerOperand(op: string): void {
    const next = this.peek();
    if (next.kind === TokenKind.StarStar) {
      throw this.err(
        `Unary operator '${op}' cannot be the left operand of '**'; write (${op}a) ** b or ${op}(a ** b)`,
        next.start,
      );
    }
  }

  private parseArgList(): ASTNode[] {
    const args: ASTNode[] = [];
    while (this.peek().kind !== TokenKind.RParen) {
      if (this.peek().kind === TokenKind.EOF) {
        throw this.err("Unterminated argument list", this.peek().start);
      }
      if (args.length > 0) this.expect(TokenKind.Comma);
      if (this.peek().kind === TokenKind.RParen) break;
      args.push(this.parseExpression(0, 0));
    }
    return args;
  }

  /**
   * Try to parse `id [, id ...]` followed by `)` as an arrow param list.
   * Returns the params if successful (and leaves the cursor after `)`),
   * or returns null if the token sequence doesn't match (leaving the cursor
   * at the start so the caller can restore with a saved position).
   */
  private tryParseArrowParamList(): Array<{ name: string; start: SourcePosition }> | null {
    const params: Array<{ name: string; start: SourcePosition }> = [];

    /* v8 ignore next -- @preserve */
    if (this.peek().kind !== TokenKind.Identifier) return null;
    const first = this.consume();
    params.push({ name: first.value, start: first.start });

    while (this.peek().kind === TokenKind.Comma) {
      this.consume(); // ,
      if (this.peek().kind !== TokenKind.Identifier) return null;
      const p = this.consume();
      params.push({ name: p.value, start: p.start });
    }

    if (this.peek().kind !== TokenKind.RParen) return null;
    this.consume(); // )

    return params;
  }
}

// ── toBinaryOp ────────────────────────────────────────────────────────────────

function toBinaryOp(op: Token): BinaryOp {
  switch (op.kind) {
    case TokenKind.Plus:           return "+";
    case TokenKind.Minus:          return "-";
    case TokenKind.Star:           return "*";
    case TokenKind.StarStar:       return "**";
    case TokenKind.Slash:          return "/";
    case TokenKind.Percent:        return "%";
    case TokenKind.Eq:             return "==";
    case TokenKind.NotEq:          return "!=";
    case TokenKind.Lt:             return "<";
    case TokenKind.Gt:             return ">";
    case TokenKind.LtEq:           return "<=";
    case TokenKind.GtEq:           return ">=";
    case TokenKind.In:             return "in";
    case TokenKind.AmpAmp:
    case TokenKind.And:            return "&&";
    case TokenKind.PipePipe:
    case TokenKind.Or:             return "||";
    case TokenKind.QuestionQuestion: return "??";
    /* v8 ignore start -- @preserve */
    default:
      throw new ParseError(`Not a binary operator: '${op.value}'`, op.start, op.end);
    /* v8 ignore stop -- @preserve */
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function parse(source: string): ASTNode {
  let tokens: Token[];
  try {
    tokens = tokenize(source);
  } catch (error) {
    /* v8 ignore next -- @preserve: tokenize() only throws LexError */
    if (!(error instanceof LexError)) throw error;
    // A lexing error is a syntax error like any other: report it as one.
    throw new ParseError(error.message, error.position);
  }
  return new Parser(tokens).parse();
}
