import type { EngineDefaults } from "./builtins/category.js";
import { createEngineWith } from "./engine/engine.js";
import type { Engine, EngineOptions } from "./engine/types.js";

const coreSet: EngineDefaults = { builtins: [] };

/**
 * An engine with no built-in registered: only the operators, `let`, arrow functions and the filters the host
 * passes in `filters` or `builtins`. `regex` defaults to `native`. Import categories from
 * `@tavnit-ts/tavnit/builtins/<name>` and pass them as `builtins: [...]`.
 */
export function createEngine(options?: EngineOptions): Engine {
  return createEngineWith(coreSet, options);
}
