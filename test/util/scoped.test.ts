import { describe, expect, it } from "vitest";

import { acquire } from "../../src/util/scoped.js";

describe("acquire", () => {
  it("releases on every exit path, in reverse declaration order", () => {
    const order: string[] = [];
    function run(fail: boolean) {
      using _outer = acquire(() => order.push("outer"));
      using _inner = acquire(() => order.push("inner"));
      order.push("body");
      if (fail) throw new Error("boom");
    }
    run(false);
    expect(() => run(true)).toThrow("boom");
    expect(order).toEqual(["body", "inner", "outer", "body", "inner", "outer"]);
  });

  it("releases at try exit, before the finally", () => {
    const order: string[] = [];
    try {
      using _guard = acquire(() => order.push("released"));
      order.push("body");
    } finally {
      order.push("finally");
    }
    expect(order).toEqual(["body", "released", "finally"]);
  });
});
