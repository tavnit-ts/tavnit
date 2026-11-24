/** A template syntax error at `offset`, the index in the template where the problem starts. */
export class TemplateError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
    this.name = "TemplateError";
  }
}

export type Span =
  | { kind: "literal"; text: string }
  | { kind: "expression"; source: string; offset: number };

/**
 * The index of the `}}` that closes the span whose expression starts at `from`, or -1.
 *
 * The scan follows the expression: a `}}` inside a string literal (`'` or `"`, `\` skips the next
 * character) or inside an open `{ … }` does not end the span, so `${{ "}}" }}` and `${{ {id: 1}}}`
 * close where they should. A string that never closes falls back to the first `}}`, so the lexer
 * reports the string and not the span.
 */
function findSpanEnd(template: string, from: number): number {
  let depth = 0;
  let pos = from;
  while (pos < template.length) {
    const ch = template[pos];
    if (ch === '"' || ch === "'") {
      const close = skipString(template, pos);
      if (close < 0) {
        return template.indexOf("}}", from);
      }
      pos = close;
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
      } else if (template[pos + 1] === "}") {
        return pos;
      }
    }
    pos++;
  }
  return -1;
}

/** The index after the string literal that opens at `start`, or -1 when it has no closing quote. */
function skipString(template: string, start: number): number {
  const quote = template[start];
  let pos = start + 1;
  while (pos < template.length) {
    const ch = template[pos];
    if (ch === "\\") {
      pos += 2;
    } else if (ch === quote) {
      return pos + 1;
    } else {
      pos++;
    }
  }
  return -1;
}

/**
 * Split a Tavnit template string into alternating literal-text and
 * expression-source segments.
 *
 * - `${{ expr }}` → expression span (source = " expr ", offset = index of `$`)
 * - `$\{{`        → literal `${{` (escape sequence)
 * - anything else → literal text
 */
export function extractSpans(template: string): Span[] {
  const spans: Span[] = [];
  let pos = 0;
  let literal = "";

  while (pos < template.length) {
    // Escape: $\{{ → literal "${{" and skip
    if (
      template[pos] === "$" &&
      template[pos + 1] === "\\" &&
      template[pos + 2] === "{" &&
      template[pos + 3] === "{"
    ) {
      literal += "${{";
      pos += 4;
      continue;
    }

    // Expression span: ${{ ... }}
    if (
      template[pos] === "$" &&
      template[pos + 1] === "{" &&
      template[pos + 2] === "{"
    ) {
      if (literal.length > 0) {
        spans.push({ kind: "literal", text: literal });
        literal = "";
      }
      const spanStart = pos;
      pos += 3; // skip "${{""
      const exprStart = pos;

      pos = findSpanEnd(template, pos);
      if (pos < 0) {
        throw new TemplateError("Unterminated expression span", spanStart);
      }

      const source = template.slice(exprStart, pos);
      spans.push({ kind: "expression", source, offset: spanStart });
      pos += 2; // skip "}}"
      continue;
    }

    literal += template[pos];
    pos++;
  }

  if (literal.length > 0) {
    spans.push({ kind: "literal", text: literal });
  }

  return spans;
}

// ── Block-tag template AST ────────────────────────────────────────────────────

export type TemplateNode =
  | { kind: "literal"; text: string }
  | { kind: "expression"; source: string; offset: number }
  | {
      kind: "if";
      condition: string;
      conditionOffset: number;
      consequent: TemplateNode[];
      elseifs: Array<{
        condition: string;
        conditionOffset: number;
        body: TemplateNode[];
      }>;
      alternate: TemplateNode[] | null;
    }
  | {
      kind: "for";
      variable: string;
      iterable: string;
      iterableOffset: number;
      body: TemplateNode[];
    };

/**
 * Parse a Tavnit template string into a `TemplateNode[]` tree that includes
 * both `${{ expr }}` expression spans and `${% if/for %}` block tags.
 *
 * - `${{ expr }}`                   → expression node
 * - `${% if cond %} … ${% endif %}` → if node
 * - `${% for x in arr %} … ${% endfor %}` → for node
 * - `$\{{`                          → literal `${{`
 * - `$\{%`                          → literal `${% `
 */
export function parseTemplate(template: string): TemplateNode[] {
  const state: ParseState = { template, pos: 0 };
  const { nodes, stop } = parseNodes(state, EMPTY_STOP_SET);
  // Structurally unreachable: parseNodes() with EMPTY_STOP_SET never returns a
  // non-null stop — STRUCTURAL_TAGS throw directly inside parseNodes instead.
  // Kept as a safety net against future logic changes.
  /* v8 ignore start -- @preserve */
  if (stop !== null) {
    throw new TemplateError(`Unexpected '${stop.name}' tag`, stop.tagPos);
  }
  /* v8 ignore stop -- @preserve */
  return nodes;
}

// ── Internal parsing helpers ──────────────────────────────────────────────────

interface ParseState {
  template: string;
  pos: number;
}

interface StopInfo {
  name: string;
  rest: string;
  restOffset: number;
  tagPos: number;
}

interface ParseNodesResult {
  nodes: TemplateNode[];
  stop: StopInfo | null;
}

// Pre-built stop-tag sets to avoid heap allocation on every call
const EMPTY_STOP_SET: ReadonlySet<string> = new Set();
const ELIF_ELSE_ENDIF: ReadonlySet<string> = new Set(["elif", "else", "endif"]);
const ENDIF_ONLY: ReadonlySet<string> = new Set(["endif"]);
const ENDFOR_ONLY: ReadonlySet<string> = new Set(["endfor"]);

// Tags that are valid only inside a block — appearing at the top level or in
// the wrong context is an error ("Unexpected").
const STRUCTURAL_TAGS: ReadonlySet<string> = new Set([
  "elif",
  "else",
  "endif",
  "endfor",
]);

/** Recursive inner parser — advances `state.pos`, returns when it hits a stop tag or end of input. */
function parseNodes(
  state: ParseState,
  stopTags: ReadonlySet<string>,
): ParseNodesResult {
  const { template } = state;
  const nodes: TemplateNode[] = [];
  let literal = "";

  while (state.pos < template.length) {
    const pos = state.pos;

    // Escape: $\{{ → literal "${"
    if (
      template[pos] === "$" &&
      template[pos + 1] === "\\" &&
      template[pos + 2] === "{" &&
      template[pos + 3] === "{"
    ) {
      literal += "${{";
      state.pos += 4;
      continue;
    }

    // Escape: $\{% → literal "${%"
    if (
      template[pos] === "$" &&
      template[pos + 1] === "\\" &&
      template[pos + 2] === "{" &&
      template[pos + 3] === "%"
    ) {
      literal += "${%";
      state.pos += 4;
      continue;
    }

    // Expression span: ${{ ... }}
    if (
      template[pos] === "$" &&
      template[pos + 1] === "{" &&
      template[pos + 2] === "{"
    ) {
      if (literal.length > 0) {
        nodes.push({ kind: "literal", text: literal });
        literal = "";
      }
      const spanStart = pos;
      state.pos += 3; // skip "${"
      const exprStart = state.pos;

      state.pos = findSpanEnd(template, state.pos);
      if (state.pos < 0) {
        throw new TemplateError("Unterminated expression span", spanStart);
      }

      const source = template.slice(exprStart, state.pos);
      nodes.push({ kind: "expression", source, offset: spanStart });
      state.pos += 2; // skip "}}"
      continue;
    }

    // Block tag: ${% ... %}
    if (
      template[pos] === "$" &&
      template[pos + 1] === "{" &&
      template[pos + 2] === "%"
    ) {
      const tagInfo = parseTagAt(template, pos);

      // If this tag is one the caller wants to stop at, flush literal and return
      if (stopTags.has(tagInfo.name)) {
        if (literal.length > 0) {
          nodes.push({ kind: "literal", text: literal });
        }
        state.pos = tagInfo.endPos;
        return {
          nodes,
          stop: {
            name: tagInfo.name,
            rest: tagInfo.rest,
            restOffset: tagInfo.restOffset,
            tagPos: pos,
          },
        };
      }

      if (literal.length > 0) {
        nodes.push({ kind: "literal", text: literal });
        literal = "";
      }
      state.pos = tagInfo.endPos;

      if (tagInfo.name === "if") {
        nodes.push(parseIfBlock(state, tagInfo.rest, tagInfo.restOffset, pos));
      } else if (tagInfo.name === "for") {
        nodes.push(parseForBlock(state, tagInfo.rest, tagInfo.restOffset, pos));
      } else if (STRUCTURAL_TAGS.has(tagInfo.name)) {
        throw new TemplateError(`Unexpected '${tagInfo.name}' tag`, pos);
      } else {
        throw new TemplateError(`Unknown tag '${tagInfo.name}'`, pos);
      }
      continue;
    }

    literal += template[pos];
    state.pos++;
  }

  if (literal.length > 0) {
    nodes.push({ kind: "literal", text: literal });
  }
  return { nodes, stop: null };
}

interface TagInfo {
  name: string;
  rest: string;
  restOffset: number;
  /** Position immediately after the closing `%}`. */
  endPos: number;
}

/**
 * Parse the tag starting at `tagStart` (position of `$`).
 * Returns the tag name, the rest of the content, the absolute offset of the
 * rest-content in the template, and the position after the closing `%}`.
 */
function parseTagAt(template: string, tagStart: number): TagInfo {
  // Content starts after `$`, `{`, `%`
  const contentStart = tagStart + 3;

  // Scan for closing "%}"
  let end = contentStart;
  while (end < template.length) {
    if (template[end] === "%" && template[end + 1] === "}") break;
    end++;
  }
  if (end >= template.length) {
    throw new TemplateError("Unterminated block tag", tagStart);
  }

  const rawContent = template.slice(contentStart, end);

  // Skip leading whitespace
  let i = 0;
  while (i < rawContent.length && (rawContent[i] === " " || rawContent[i] === "\t")) {
    i++;
  }

  // Read tag name (non-whitespace run)
  const nameStart = i;
  while (i < rawContent.length && rawContent[i] !== " " && rawContent[i] !== "\t") {
    i++;
  }
  const name = rawContent.slice(nameStart, i);

  if (!name) {
    throw new TemplateError("Empty block tag", tagStart);
  }

  // Skip whitespace after name
  while (i < rawContent.length && (rawContent[i] === " " || rawContent[i] === "\t")) {
    i++;
  }

  const rest = rawContent.slice(i).trimEnd();
  const restOffset = contentStart + i; // absolute position in the full template

  return { name, rest, restOffset, endPos: end + 2 }; // +2 skips "%}"
}

/** Parse an `if` block. `state.pos` must be immediately after the opening `${% if cond %}` tag. */
function parseIfBlock(
  state: ParseState,
  condition: string,
  conditionOffset: number,
  tagPos: number,
): TemplateNode {
  const { nodes: consequent, stop: firstStop } = parseNodes(
    state,
    ELIF_ELSE_ENDIF,
  );
  if (firstStop === null) {
    throw new TemplateError("Unterminated 'if' block", tagPos);
  }

  const elseifs: Array<{
    condition: string;
    conditionOffset: number;
    body: TemplateNode[];
  }> = [];
  let alternate: TemplateNode[] | null = null;
  let currentStop = firstStop;

  // Consume any number of elif branches
  while (currentStop.name === "elif") {
    const elifCond = currentStop.rest;
    const elifCondOffset = currentStop.restOffset;
    const { nodes: elifBody, stop: nextStop } = parseNodes(
      state,
      ELIF_ELSE_ENDIF,
    );
    if (nextStop === null) {
      throw new TemplateError("Unterminated 'if' block", tagPos);
    }
    elseifs.push({ condition: elifCond, conditionOffset: elifCondOffset, body: elifBody });
    currentStop = nextStop;
  }

  // Optional else branch
  if (currentStop.name === "else") {
    const { nodes: altNodes, stop: endStop } = parseNodes(state, ENDIF_ONLY);
    if (endStop === null) {
      throw new TemplateError("Unterminated 'if' block", tagPos);
    }
    alternate = altNodes;
  }
  // else: currentStop.name === "endif" — no alternate

  return {
    kind: "if",
    condition,
    conditionOffset,
    consequent,
    elseifs,
    alternate,
  };
}

/** Parse a `for` block. `state.pos` must be immediately after the opening `${% for ... %}` tag. */
function parseForBlock(
  state: ParseState,
  tagBody: string,
  restOffset: number,
  tagPos: number,
): TemplateNode {
  let i = 0;

  // Read identifier (loop variable name)
  if (i >= tagBody.length || !/[a-zA-Z_]/.test(tagBody.charAt(i))) {
    throw new TemplateError("Expected an identifier for loop variable in 'for' tag", tagPos);
  }
  const identStart = i;
  while (i < tagBody.length && /\w/.test(tagBody.charAt(i))) {
    i++;
  }
  const variable = tagBody.slice(identStart, i);

  // Skip whitespace
  while (i < tagBody.length && (tagBody[i] === " " || tagBody[i] === "\t")) {
    i++;
  }

  // Expect `in` keyword (must not be followed by an identifier char — prevents `infoo` matching)
  if (
    tagBody.slice(i, i + 2) !== "in" ||
    (i + 2 < tagBody.length && /\w/.test(tagBody.charAt(i + 2)))
  ) {
    throw new TemplateError("Expected 'in' after loop variable in 'for' tag", tagPos);
  }
  i += 2;

  // Skip whitespace
  while (i < tagBody.length && (tagBody[i] === " " || tagBody[i] === "\t")) {
    i++;
  }

  const iterable = tagBody.slice(i).trimEnd();
  if (!iterable) {
    throw new TemplateError("Expected an iterable expression in 'for' tag", tagPos);
  }
  const iterableOffset = restOffset + i;

  const { nodes: body, stop } = parseNodes(state, ENDFOR_ONLY);
  if (stop === null) {
    throw new TemplateError("Unterminated 'for' block", tagPos);
  }

  return {
    kind: "for",
    variable,
    iterable,
    iterableOffset,
    body,
  };
}
