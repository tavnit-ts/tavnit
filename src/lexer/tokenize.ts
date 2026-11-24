import { type SourcePosition, type Token, TokenKind } from "./token.js";

// A Map, not an object literal: `constructor` or `toString` must not find an Object.prototype member.
const RESERVED = new Map<string, TokenKind>([
  ["true", TokenKind.True],
  ["false", TokenKind.False],
  ["null", TokenKind.Null],
  ["and", TokenKind.And],
  ["or", TokenKind.Or],
  ["not", TokenKind.Not],
  ["in", TokenKind.In],
  ["let", TokenKind.Let],
]);

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string): boolean {
  return ch === "_" || /^\p{L}$/u.test(ch);
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || /^\p{N}$/u.test(ch);
}

/** An unterminated string or an unrecognised character at `position`. */
export class LexError extends Error {
  constructor(
    message: string,
    readonly position: SourcePosition,
  ) {
    super(message);
    this.name = "LexError";
  }
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let col = 1;

  function pos2(): SourcePosition {
    return { line, column: col };
  }

  function ch(offset = 0): string {
    return source[pos + offset] ?? "";
  }

  function advance(count = 1): void {
    for (let i = 0; i < count; i++) {
      if (source[pos] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      pos++;
    }
  }

  function emit(kind: TokenKind, value: string, start: SourcePosition): void {
    tokens.push({ kind, value, start, end: pos2() });
  }

  function readString(quote: string): Token {
    const start = pos2();
    const q = quote;
    advance(); // opening quote
    let raw = q;
    while (pos < source.length && ch() !== q) {
      if (ch() === "\\") {
        raw += ch();
        advance();
        if (pos < source.length) {
          raw += ch();
          advance();
        }
      } else if (ch() === "\n") {
        throw lexError(`Unterminated string literal`, start);
      } else {
        raw += ch();
        advance();
      }
    }
    if (pos >= source.length) {
      throw lexError(`Unterminated string literal`, start);
    }
    raw += q;
    advance(); // closing quote
    return { kind: TokenKind.String, value: raw, start, end: pos2() };
  }

  /** Digits with single `_` separators between two digits (`1_000`); the separators are dropped. */
  function readDigits(): string {
    let digits = "";
    while (pos < source.length) {
      if (isDigit(ch())) {
        digits += ch();
        advance();
      } else if (ch() === "_" && digits !== "" && isDigit(ch(1))) {
        advance();
      } else {
        break;
      }
    }
    return digits;
  }

  /** A number literal; it starts at a digit, or at the `.` of `.5`. */
  function readNumber(): Token {
    const start = pos2();
    let raw = readDigits();
    if (ch() === "." && isDigit(ch(1))) {
      advance(); // dot
      raw += `.${readDigits()}`;
    }
    // Exponent: `e` or `E`, an optional sign, then at least one digit; otherwise `e` is left alone.
    if (ch() === "e" || ch() === "E") {
      const signed = ch(1) === "+" || ch(1) === "-";
      if (isDigit(ch(signed ? 2 : 1))) {
        raw += ch();
        advance();
        if (signed) {
          raw += ch();
          advance();
        }
        raw += readDigits();
      }
    }
    if (raw === "0" && /^[xXbBoO]$/.test(ch()) && isDigit(ch(1))) {
      throw new LexError("Hexadecimal, binary and octal number literals are not supported; write the decimal number", start);
    }
    return { kind: TokenKind.Number, value: raw, start, end: pos2() };
  }

  /** A `.` starts a number (`.5`) unless the token before it ends a value (`a.5`, `x[0].5`). */
  function dotStartsNumber(): boolean {
    if (ch() !== "." || !isDigit(ch(1))) return false;
    const prev = tokens[tokens.length - 1];
    return (
      prev === undefined ||
      !(
        prev.kind === TokenKind.Number ||
        prev.kind === TokenKind.String ||
        prev.kind === TokenKind.Identifier ||
        prev.kind === TokenKind.RParen ||
        prev.kind === TokenKind.RBracket ||
        prev.kind === TokenKind.RBrace ||
        prev.kind === TokenKind.True ||
        prev.kind === TokenKind.False ||
        prev.kind === TokenKind.Null
      )
    );
  }

  function lexError(message: string, at?: SourcePosition): LexError {
    /* v8 ignore next -- @preserve */
    return new LexError(message, at ?? pos2());
  }

  while (pos < source.length) {
    // Skip whitespace (spaces, tabs, newlines)
    if (ch() === " " || ch() === "\t" || ch() === "\r" || ch() === "\n") {
      advance();
      continue;
    }

    const start = pos2();
    const c = ch();

    // String literals
    if (c === '"' || c === "'") {
      tokens.push(readString(c));
      continue;
    }

    // Number literals
    if (isDigit(c) || dotStartsNumber()) {
      tokens.push(readNumber());
      continue;
    }

    // Identifiers and reserved words
    if (isIdentStart(c)) {
      let raw = "";
      while (pos < source.length && isIdentPart(ch())) {
        raw += ch();
        advance();
      }
      const kind = RESERVED.get(raw) ?? TokenKind.Identifier;
      emit(kind, raw, start);
      continue;
    }

    // Multi-character operators (longest match first)
    if (c === "*" && ch(1) === "*") {
      advance(2);
      emit(TokenKind.StarStar, "**", start);
      continue;
    }
    if (c === "&" && ch(1) === "&") {
      advance(2);
      emit(TokenKind.AmpAmp, "&&", start);
      continue;
    }
    if (c === "|" && ch(1) === "|") {
      advance(2);
      emit(TokenKind.PipePipe, "||", start);
      continue;
    }
    if (c === "?" && ch(1) === "?") {
      advance(2);
      emit(TokenKind.QuestionQuestion, "??", start);
      continue;
    }
    if (c === "?" && ch(1) === "." && !isDigit(ch(2))) {
      advance(2);
      emit(TokenKind.QuestionDot, "?.", start);
      continue;
    }
    if (c === "=" && ch(1) === ">") {
      advance(2);
      emit(TokenKind.Arrow, "=>", start);
      continue;
    }
    if (c === "=" && ch(1) === "=") {
      advance(2);
      emit(TokenKind.Eq, "==", start);
      continue;
    }
    if (c === "=" && ch(1) !== "=" && ch(1) !== ">") {
      advance(1);
      emit(TokenKind.Assign, "=", start);
      continue;
    }
    if (c === "!" && ch(1) === "=") {
      advance(2);
      emit(TokenKind.NotEq, "!=", start);
      continue;
    }
    if (c === "<" && ch(1) === "=") {
      advance(2);
      emit(TokenKind.LtEq, "<=", start);
      continue;
    }
    if (c === ">" && ch(1) === "=") {
      advance(2);
      emit(TokenKind.GtEq, ">=", start);
      continue;
    }

    // Single-character operators and brackets
    advance(1);
    switch (c) {
      case "+": emit(TokenKind.Plus, "+", start); break;
      case "-": emit(TokenKind.Minus, "-", start); break;
      case "*": emit(TokenKind.Star, "*", start); break;
      case "/": emit(TokenKind.Slash, "/", start); break;
      case "%": emit(TokenKind.Percent, "%", start); break;
      case "!": emit(TokenKind.Bang, "!", start); break;
      case "|": emit(TokenKind.PipeOp, "|", start); break;
      case "?": emit(TokenKind.Question, "?", start); break;
      case ":": emit(TokenKind.Colon, ":", start); break;
      case "<": emit(TokenKind.Lt, "<", start); break;
      case ">": emit(TokenKind.Gt, ">", start); break;
      case ".": emit(TokenKind.Dot, ".", start); break;
      case ",": emit(TokenKind.Comma, ",", start); break;
      case "(": emit(TokenKind.LParen, "(", start); break;
      case ")": emit(TokenKind.RParen, ")", start); break;
      case "[": emit(TokenKind.LBracket, "[", start); break;
      case "]": emit(TokenKind.RBracket, "]", start); break;
      case "{": emit(TokenKind.LBrace, "{", start); break;
      case "}": emit(TokenKind.RBrace, "}", start); break;
      default:
        throw lexError(`Unexpected character '${c}'`, start);
    }
  }

  const eofStart = pos2();
  tokens.push({ kind: TokenKind.EOF, value: "", start: eofStart, end: eofStart });
  return tokens;
}
