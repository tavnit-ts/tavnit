import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("temporal-polyfill", () => {
  it("takes the runtime's own Temporal when it has one", async () => {
    const native = { native: true };
    vi.stubGlobal("Temporal", native);
    vi.resetModules();
    const mod = await import("./temporal-polyfill.js");
    expect(mod.Temporal).toBe(native);
  });

  it("falls back to the polyfill when the runtime has none", async () => {
    vi.stubGlobal("Temporal", undefined);
    vi.resetModules();
    const mod = await import("./temporal-polyfill.js");
    expect(typeof mod.Temporal.Instant.from).toBe("function");
  });
});

describe("temporal registration point", () => {
  it("raises a coded error while the runtime has none and nothing is registered", async () => {
    vi.stubGlobal("Temporal", undefined);
    vi.resetModules();
    const { temporal } = await import("./temporal.js");
    expect(() => temporal()).toThrow(/installTemporalPolyfill/);
  });

  it("serves the registered Temporal on a runtime without one", async () => {
    vi.stubGlobal("Temporal", undefined);
    vi.resetModules();
    const { temporal } = await import("./temporal.js");
    const { installTemporalPolyfill } = await import("./temporal-polyfill.js");
    installTemporalPolyfill();
    expect(typeof temporal().Instant.from).toBe("function");
  });

  it("prefers the runtime's own Temporal to a registered one", async () => {
    const native = { native: true };
    vi.stubGlobal("Temporal", native);
    vi.resetModules();
    const { temporal, registerTemporal } = await import("./temporal.js");
    const { Temporal } = await import("@js-temporal/polyfill");
    registerTemporal(Temporal);
    expect(temporal()).toBe(native);
  });
});
