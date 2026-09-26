// Canonical JSON for audit hashing. Deterministic, so the writer and any verifier
// (including an independent re-implementation) serialize a payload to identical bytes.
//
//   * object keys sorted by UTF-16 code unit (default JS sort), recursively
//   * arrays keep their order
//   * no whitespace; strings encoded with JSON.stringify
//   * allowed: null, booleans, strings, safe integers, arrays, plain objects
//   * rejected: undefined, functions, symbols, bigint, NaN, Infinity, non-integer numbers
//     (Postgres jsonb may reformat floats on round-trip), unsafe integers, and non-plain
//     objects such as Date or Map

export class CanonicalJsonError extends Error {
  constructor(path: string, detail: string) {
    super(`canonicalJson: ${detail} at ${path || "<root>"}`);
    this.name = "CanonicalJsonError";
  }
}

export function canonicalJson(value: unknown): string {
  return serialize(value, "");
}

function serialize(value: unknown, path: string): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalJsonError(path, "non-finite number");
      if (!Number.isInteger(value)) throw new CanonicalJsonError(path, "non-integer number");
      if (!Number.isSafeInteger(value)) throw new CanonicalJsonError(path, "unsafe integer");
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new CanonicalJsonError(path, `unsupported type ${typeof value}`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item, i) => serialize(item, `${path}[${i}]`)).join(",")}]`;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new CanonicalJsonError(path, "non-plain object");
  }

  const obj = value as Record<string, unknown>;
  const parts = Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${serialize(obj[key], `${path}.${key}`)}`);
  return `{${parts.join(",")}}`;
}
