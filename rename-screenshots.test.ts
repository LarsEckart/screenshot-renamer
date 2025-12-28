import { test, expect, describe } from "bun:test";
import {
  isMacOSScreenshot,
  getDateTimePrefix,
  sanitizeFilename,
  formatErrorMessage,
} from "./rename-screenshots";

describe("isMacOSScreenshot", () => {
  test("recognizes valid macOS screenshot patterns", () => {
    expect(isMacOSScreenshot("Screenshot 2024-12-10 at 3.45.22 PM.png")).toBe(true);
    expect(isMacOSScreenshot("Screenshot 2024-01-01 at 12.00.00 AM.png")).toBe(true);
    expect(isMacOSScreenshot("Screenshot 2024-12-10 at 10.05.33 AM.png")).toBe(true);
  });

  test("rejects non-screenshot filenames", () => {
    expect(isMacOSScreenshot("my-file.png")).toBe(false);
    expect(isMacOSScreenshot("screenshot.png")).toBe(false);
    expect(isMacOSScreenshot("Screenshot.png")).toBe(false);
    expect(isMacOSScreenshot("Screenshot 2024-12-10.png")).toBe(false);
  });

  test("rejects malformed dates", () => {
    expect(isMacOSScreenshot("Screenshot 24-12-10 at 3.45.22 PM.png")).toBe(false);
    expect(isMacOSScreenshot("Screenshot 2024-1-10 at 3.45.22 PM.png")).toBe(false);
  });
});

describe("getDateTimePrefix", () => {
  test("extracts date and time with zero-padded hour", () => {
    expect(getDateTimePrefix("Screenshot 2024-12-10 at 3.45.22 PM.png")).toBe("2024-12-10-03-45");
    expect(getDateTimePrefix("Screenshot 2024-01-05 at 9.05.00 AM.png")).toBe("2024-01-05-09-05");
  });

  test("handles double-digit hours", () => {
    expect(getDateTimePrefix("Screenshot 2024-12-10 at 12.30.00 PM.png")).toBe("2024-12-10-12-30");
    expect(getDateTimePrefix("Screenshot 2024-12-10 at 10.15.45 AM.png")).toBe("2024-12-10-10-15");
  });

  test("throws for non-screenshot filenames", () => {
    expect(() => getDateTimePrefix("my-file.png")).toThrow("Not a macOS screenshot");
    expect(() => getDateTimePrefix("random.png")).toThrow("Not a macOS screenshot");
  });
});

describe("sanitizeFilename", () => {
  test("converts to lowercase", () => {
    expect(sanitizeFilename("Hello-World")).toBe("hello-world");
    expect(sanitizeFilename("ALLCAPS")).toBe("allcaps");
  });

  test("replaces spaces and special chars with hyphens", () => {
    expect(sanitizeFilename("hello world")).toBe("hello-world");
    expect(sanitizeFilename("hello_world")).toBe("hello-world");
    expect(sanitizeFilename("hello.world")).toBe("hello-world");
    expect(sanitizeFilename("hello@world!")).toBe("hello-world");
  });

  test("collapses multiple hyphens", () => {
    expect(sanitizeFilename("hello---world")).toBe("hello-world");
    expect(sanitizeFilename("hello   world")).toBe("hello-world");
    expect(sanitizeFilename("a--b--c")).toBe("a-b-c");
  });

  test("removes leading and trailing hyphens", () => {
    expect(sanitizeFilename("-hello-")).toBe("hello");
    expect(sanitizeFilename("---hello---")).toBe("hello");
    expect(sanitizeFilename("  hello  ")).toBe("hello");
  });

  test("truncates to 50 characters", () => {
    const longName = "a".repeat(100);
    expect(sanitizeFilename(longName)).toHaveLength(50);
  });

  test("handles empty and whitespace input", () => {
    expect(sanitizeFilename("")).toBe("");
    expect(sanitizeFilename("   ")).toBe("");
  });

  test("preserves numbers", () => {
    expect(sanitizeFilename("version-2-release")).toBe("version-2-release");
    expect(sanitizeFilename("2024-12-10")).toBe("2024-12-10");
  });
});

describe("formatErrorMessage", () => {
  test("extracts message from Anthropic API error JSON", () => {
    const apiError =
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"image exceeds 5 MB maximum: 6091236 bytes > 5242880 bytes"},"request_id":"req_011CW8NDq2wpQ8iSooRPCrfD"}';
    expect(formatErrorMessage(new Error(apiError))).toBe(
      "image exceeds 5 MB maximum: 6091236 bytes > 5242880 bytes"
    );
  });

  test("returns plain message if no JSON found", () => {
    expect(formatErrorMessage(new Error("Network timeout"))).toBe("Network timeout");
    expect(formatErrorMessage(new Error("File not found"))).toBe("File not found");
  });

  test("handles non-Error values", () => {
    expect(formatErrorMessage("string error")).toBe("string error");
    expect(formatErrorMessage(42)).toBe("42");
    expect(formatErrorMessage(null)).toBe("null");
  });

  test("extracts message from other JSON error formats", () => {
    const otherError = '{"error": {"message": "Rate limit exceeded"}}';
    expect(formatErrorMessage(new Error(otherError))).toBe("Rate limit exceeded");
  });
});
