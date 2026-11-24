// Type-level tests of the public and internal entry points (run by `vitest --typecheck`).
import { describe, expectTypeOf, it } from "vitest";
import * as publicApi from "./index.js";
import type { Analysis, CheckOptions, DataContext, Diagnostic, Engine, EngineOptions, FilterFn, Value } from "./index.js";
import { createEngine, type Expression, ExpressionError, type TextTemplate, type ValueTemplate } from "./index.js";
import * as hostApi from "./host.js";
import * as internalApi from "./internal.js";
import type { ASTNode, Token, TokenKind } from "./internal.js";

describe("@tavnit-ts/tavnit types", () => {
  it("createEngine returns an Engine", () => {
    expectTypeOf(createEngine).returns.toEqualTypeOf<Engine>();
    expectTypeOf(createEngine).parameter(0).toEqualTypeOf<Partial<EngineOptions> | undefined>();
  });

  it("Engine methods", () => {
    expectTypeOf<Engine["evaluate"]>().returns.toEqualTypeOf<Promise<Value>>();
    expectTypeOf<Engine["render"]>().returns.toEqualTypeOf<Promise<string>>();
    expectTypeOf<Engine["renderObject"]>().returns.toEqualTypeOf<Promise<Value>>();
    expectTypeOf<Engine["compile"]>().returns.toEqualTypeOf<FilterFn>();
    expectTypeOf<Engine["derive"]>().returns.toEqualTypeOf<Engine>();
    expectTypeOf<Engine["parseValueTemplate"]>().returns.toEqualTypeOf<ValueTemplate>();
    expectTypeOf<Engine["parse"]>().toBeFunction();
  });

  it("synchronous methods return the value itself", () => {
    expectTypeOf<Engine["evaluateSync"]>().returns.toEqualTypeOf<Value>();
    expectTypeOf<Engine["renderSync"]>().returns.toEqualTypeOf<string>();
    expectTypeOf<Engine["renderObjectSync"]>().returns.toEqualTypeOf<Value>();
  });

  it("the entry points take one kind of source each", () => {
    const engine = createEngine();
    expectTypeOf(engine.evaluate).toBeCallableWith("a + 1", {});
    expectTypeOf(engine.render).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(engine.renderObject).parameter(0).toEqualTypeOf<Value | ValueTemplate>();
    expectTypeOf(engine.evaluateSync).parameter(0).toEqualTypeOf<Expression | string>();
  });

  it("parseTextTemplate returns the exported opaque handle", () => {
    expectTypeOf<Engine["parseTextTemplate"]>().returns.toEqualTypeOf<TextTemplate>();
  });

  it("analyze and check", () => {
    expectTypeOf<Engine["analyze"]>().returns.toEqualTypeOf<Analysis>();
    expectTypeOf<Engine["check"]>().returns.toEqualTypeOf<Diagnostic[]>();
    expectTypeOf<CheckOptions>().toHaveProperty("variables");
    expectTypeOf<Analysis["variables"]>().toEqualTypeOf<string[]>();
  });

  it("classes", () => {
    expectTypeOf<ExpressionError>().toExtend<Error>();
    expectTypeOf(ExpressionError).constructorParameters.not.toBeNever();
    expectTypeOf<Expression>().not.toBeAny();
    expectTypeOf<ValueTemplate>().not.toBeAny();
  });

  it("data types", () => {
    expectTypeOf<DataContext>().not.toBeAny();
    expectTypeOf<Diagnostic>().not.toBeAny();
    expectTypeOf<Value>().not.toBeAny();
    expectTypeOf<string>().toExtend<Value>();
  });

  it("builtinFilterNames and serialisation", () => {
    expectTypeOf(publicApi.serialiseValue).toBeFunction();
    expectTypeOf(publicApi.deserialiseValue).toBeFunction();
    expectTypeOf(publicApi.builtinFilterNames).not.toBeAny();
  });
});

describe("@tavnit-ts/tavnit/host types", () => {
  it("host integration", () => {
    expectTypeOf(hostApi.resolve).returns.toEqualTypeOf<hostApi.Resolver>();
    expectTypeOf(hostApi.contextFilter).returns.toEqualTypeOf<hostApi.ContextFilterFn>();
    expectTypeOf<hostApi.EvaluationOptions>().toHaveProperty("callHostFunction");
  });
});

describe("@tavnit-ts/tavnit/internal types", () => {
  it("lexer and parser", () => {
    expectTypeOf(internalApi.tokenize).returns.toExtend<Token[]>();
    expectTypeOf(internalApi.parse).returns.toExtend<ASTNode>();
    expectTypeOf<Token["kind"]>().toEqualTypeOf<TokenKind>();
  });

  it("evaluator", () => {
    expectTypeOf(internalApi.evaluate).toBeFunction();
    expectTypeOf(internalApi.evaluateAsync).returns.toExtend<Promise<unknown>>();
    expectTypeOf(internalApi.EvaluationError).not.toBeAny();
  });

  it("lint", () => {
    expectTypeOf(internalApi.lintValueTemplate).toBeFunction();
    expectTypeOf(internalApi.TAVNIT_LINT_CODE).not.toBeAny();
  });
});
