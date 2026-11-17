import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sourceDirectory = join(process.cwd(), "src", "features");

function findFeatureStyles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findFeatureStyles(path);
    return entry.isFile() && entry.name.endsWith(".css") ? [path] : [];
  });
}

describe("application palette", () => {
  it("does not use pure blue in app or feature styles", () => {
    const styles = [
      join(process.cwd(), "src", "index.css"),
      ...findFeatureStyles(sourceDirectory),
    ];
    const blueStyles = styles.filter((path) =>
      /#0000ff/i.test(readFileSync(path, "utf8")),
    );

    expect(blueStyles).toEqual([]);
  });
});
