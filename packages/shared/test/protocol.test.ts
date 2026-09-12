import { describe, expect, it } from "vitest";
import { EMPTY_FRAME } from "../src/input";
import { MAX_MESSAGE_BYTES, parseClientMessage } from "../src/protocol";

const j = (o: unknown) => JSON.stringify(o);

describe("parseClientMessage", () => {
  it("accepts HELLO with and without an uppercase room id", () => {
    expect(parseClientMessage(j({ type: "HELLO", name: "Hruday", protocolVersion: 2 })).ok).toBe(true);
    expect(parseClientMessage(j({ type: "HELLO", name: "H", roomId: "AB12C", protocolVersion: 2 })).ok).toBe(true);
    expect(parseClientMessage(j({ type: "HELLO", name: "H", roomId: "ab12c", protocolVersion: 2 })).ok).toBe(false);
    expect(parseClientMessage(j({ type: "HELLO", name: "x".repeat(17), protocolVersion: 2 })).ok).toBe(false);
    expect(parseClientMessage(j({ type: "HELLO", name: "H" })).ok).toBe(false); // protocolVersion is required
  });
  it("accepts INPUT with a positive int seq and a strict frame", () => {
    expect(parseClientMessage(j({ type: "INPUT", seq: 1, frame: EMPTY_FRAME })).ok).toBe(true);
    expect(parseClientMessage(j({ type: "INPUT", seq: 0, frame: EMPTY_FRAME })).ok).toBe(false);
    expect(parseClientMessage(j({ type: "INPUT", seq: 1, frame: { ...EMPTY_FRAME, extra: 1 } })).ok).toBe(false);
  });
  it("rejects garbage, arrays, unknown types, oversized frames", () => {
    expect(parseClientMessage("nope").ok).toBe(false);
    expect(parseClientMessage("[1,2]").ok).toBe(false);
    expect(parseClientMessage(j({ type: "HACK" })).ok).toBe(false);
    expect(parseClientMessage(j({ type: "HELLO", name: "x".repeat(MAX_MESSAGE_BYTES) })).ok).toBe(false);
    expect(parseClientMessage(42).ok).toBe(false);
  });
});
