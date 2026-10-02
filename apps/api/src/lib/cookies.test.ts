import { describe, expect, it } from "vitest";
import { parseCookieHeader } from "./cookies";

describe("parseCookieHeader", () => {
  it("returns an empty object for undefined header", () => {
    expect(parseCookieHeader(undefined)).toEqual({});
  });

  it("returns an empty object for an empty header", () => {
    expect(parseCookieHeader("")).toEqual({});
  });

  it("parses a single cookie", () => {
    expect(parseCookieHeader("dm_session=abc123")).toEqual({ dm_session: "abc123" });
  });

  it("parses multiple cookies", () => {
    expect(parseCookieHeader("a=1; b=2; dm_session=abc123")).toEqual({
      a: "1",
      b: "2",
      dm_session: "abc123"
    });
  });

  it("URL-decodes cookie values", () => {
    expect(parseCookieHeader("name=hello%20world")).toEqual({ name: "hello world" });
  });

  it("ignores malformed segments without a '='", () => {
    expect(parseCookieHeader("a=1; garbage; b=2")).toEqual({ a: "1", b: "2" });
  });
});
