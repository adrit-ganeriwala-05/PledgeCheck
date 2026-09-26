import { describe, expect, it } from "vitest";

import { canonicalJson, CanonicalJsonError } from "./canonical";

describe("canonicalJson", () => {
  it("is independent of key insertion order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("sorts nested objects recursively and keeps array order", () => {
    expect(canonicalJson({ z: { y: 1, x: [3, 1, { d: null, c: true }] }, a: "s" })).toBe(
      '{"a":"s","z":{"x":[3,1,{"c":true,"d":null}],"y":1}}',
    );
  });

  it("sorts by UTF-16 code unit", () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3, "é": 4 })).toBe('{"B":2,"a":3,"b":1,"é":4}');
  });

  it("encodes strings with JSON.stringify", () => {
    expect(canonicalJson({ s: 'quote " and \n newline' })).toBe('{"s":"quote \\" and \\n newline"}');
  });

  it("allows null and safe integers", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson({ n: Number.MAX_SAFE_INTEGER, m: -5 })).toBe(
      `{"m":-5,"n":${Number.MAX_SAFE_INTEGER}}`,
    );
  });

  it.each([
    ["undefined", undefined],
    ["undefined property", { a: undefined }],
    ["function", () => 1],
    ["symbol", Symbol("x")],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["bigint", BigInt(1)],
    ["float", 1.5],
    ["nested float", { a: [{ b: 0.1 }] }],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
    ["Date", new Date(0)],
    ["Map", new Map()],
  ])("throws on %s", (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
  });
});
