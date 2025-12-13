import { test, expect, describe } from "bun:test";
import { sanitizeFilename } from "./image-renamer";

describe("sanitizeFilename", () => {
  test("converts to lowercase with hyphens", () => {
    expect(sanitizeFilename("Hello World")).toBe("hello-world");
  });

  test("removes special characters", () => {
    expect(sanitizeFilename("file@name#test!")).toBe("file-name-test");
  });

  test("collapses multiple hyphens", () => {
    expect(sanitizeFilename("file---name")).toBe("file-name");
  });

  test("trims hyphens from start and end", () => {
    expect(sanitizeFilename("-hello-world-")).toBe("hello-world");
  });

  test("truncates to 50 characters", () => {
    const longName = "a".repeat(60);
    expect(sanitizeFilename(longName).length).toBe(50);
  });
});
