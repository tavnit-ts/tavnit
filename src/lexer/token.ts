export const TokenKind = {
  // Literals
  Number: "Number",
  String: "String",
  True: "True",
  False: "False",
  Null: "Null",

  // Identifiers and reserved words
  Identifier: "Identifier",
  Let: "Let",
  In: "In",       // used for both let…in and membership "in" — parser disambiguates
  And: "And",
  Or: "Or",
  Not: "Not",

  // Operators
  Plus: "Plus",           // +
  Minus: "Minus",         // -
  Star: "Star",           // *
  StarStar: "StarStar",   // **
  Slash: "Slash",         // /
  Percent: "Percent",     // %
  Bang: "Bang",           // !
  AmpAmp: "AmpAmp",       // &&
  PipePipe: "PipePipe",   // ||
  PipeOp: "PipeOp",       // |
  Question: "Question",   // ?
  QuestionQuestion: "QuestionQuestion", // ??
  QuestionDot: "QuestionDot",           // ?.
  Colon: "Colon",         // :
  Eq: "Eq",               // ==
  NotEq: "NotEq",         // !=
  Lt: "Lt",               // <
  Gt: "Gt",               // >
  LtEq: "LtEq",           // <=
  GtEq: "GtEq",           // >=
  Arrow: "Arrow",         // =>
  Assign: "Assign",       // =  (used in let…in bindings)
  Dot: "Dot",             // .
  Comma: "Comma",         // ,

  // Brackets
  LParen: "LParen",
  RParen: "RParen",
  LBracket: "LBracket",
  RBracket: "RBracket",
  LBrace: "LBrace",
  RBrace: "RBrace",

  // Control
  EOF: "EOF",
} as const;

export type TokenKind = (typeof TokenKind)[keyof typeof TokenKind];

export interface SourcePosition {
  /** 1-based line number */
  line: number;
  /** 1-based column number */
  column: number;
}

export interface Token {
  kind: TokenKind;
  /** Raw source text of the token */
  value: string;
  start: SourcePosition;
  end: SourcePosition;
}
