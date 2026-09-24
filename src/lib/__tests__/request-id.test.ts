import { describe, it, expect } from "vitest";
import {
  REQUEST_ID_HEADER,
  randomRequestId,
  isValidRequestId,
  normalizeRequestId,
  requestIdFromHeaders,
} from "@/lib/request-id";

const UUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("request-id", () => {
  it("exposes the header name", () => {
    expect(REQUEST_ID_HEADER).toBe("x-request-id");
  });

  it("generates a valid UUID", () => {
    const id = randomRequestId();
    expect(isValidRequestId(id)).toBe(true);
    expect(id).not.toBe(randomRequestId());
  });

  it("accepts a well-formed inbound id and lowercases it", () => {
    expect(normalizeRequestId(UUID.toUpperCase())).toBe(UUID);
  });

  // Review Focus 4: the value lands in a log stream, so anything malformed is
  // discarded rather than echoed. A CRLF would otherwise forge a second log line.
  it.each([
    ["missing", null],
    ["empty", ""],
    ["not a uuid", "abc123"],
    ["crlf injection", `${UUID}\r\n{"evt":"security","type":"forged"}`],
    ["newline injection", `${UUID}\ninjected`],
    ["overlong", "a".repeat(10_000)],
    ["uuid with trailing text", `${UUID}-extra`],
  ])("regenerates for an inbound id that is %s", (_label, inbound) => {
    const result = normalizeRequestId(inbound as string | null);
    expect(isValidRequestId(result)).toBe(true);
    expect(result).not.toBe(inbound);
  });

  it("reads a valid id from headers and ignores an invalid one", () => {
    expect(requestIdFromHeaders(new Headers({ [REQUEST_ID_HEADER]: UUID }))).toBe(UUID);
    expect(requestIdFromHeaders(new Headers({ [REQUEST_ID_HEADER]: "nope" }))).toBeUndefined();
    expect(requestIdFromHeaders(new Headers())).toBeUndefined();
  });
});
