import type { SourcePosition } from "../lexer/token.js";
import type { Diagnostic } from "./types.js";

export interface FormatOptions {
  /** What the source is — a file path or a field name — printed before the position. */
  name?: string;
}

/**
 * One diagnostic as text:
 *
 * ```
 * name:1:6: error: Cannot access property 'x' on null
 *   at body.items[0]
 *   1 | null.x
 *     |      ^
 * ```
 *
 * The first line has `error: message` or `warning: message`; the position, the value-template
 * path and the source excerpt appear when the diagnostic carries them.
 */
export function formatDiagnostic(diagnostic: Diagnostic, options: FormatOptions = {}): string {
  const { message, location, path, severity = "error" } = diagnostic;
  const start = location?.start;
  const position = [options.name, start && `${start.line}:${start.column}`].filter(Boolean).join(":");
  const lines = [`${position ? `${position}: ` : ""}${severity}: ${message}`];
  if (path && path.length > 0) lines.push(`  at ${formatPath(path)}`);
  if (location) lines.push(...excerpt(location.source, start, location.end));
  return lines.join("\n");
}

/** A value-template path as an accessor: `body.items[0]["content-type"]`. */
function formatPath(path: Array<string | number>): string {
  return path
    .map((key, i) => {
      if (typeof key === "number") return `[${key}]`;
      if (/^[A-Za-z_$][\w$]*$/.test(key)) return i === 0 ? key : `.${key}`;
      return `[${JSON.stringify(key)}]`;
    })
    .join("");
}

/**
 * The source line the error is on, with a caret under the failing span. Without
 * a position only a one-line source is shown, without a caret.
 */
function excerpt(source: string, start?: SourcePosition, end?: SourcePosition): string[] {
  const sourceLines = source.split("\n");
  if (!start) return sourceLines.length === 1 && source.trim() ? [`  | ${source}`] : [];
  const text = sourceLines[start.line - 1] ?? "";
  const gutter = String(start.line);
  const pad = " ".repeat(gutter.length);
  // Keep tabs so the caret lines up under a tab-indented source.
  const indent = text.slice(0, start.column - 1).replace(/[^\t]/g, " ");
  const width = end && end.line === start.line && end.column > start.column
    ? end.column - start.column
    : 1;
  return [`  ${gutter} | ${text}`, `  ${pad} | ${indent}${"^".repeat(width)}`];
}
