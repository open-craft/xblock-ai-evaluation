import { renderMarkdown } from "./renderMarkdown";

describe("renderMarkdown", () => {
  it("returns empty string for empty input", () => {
    expect(renderMarkdown("")).toBe("");
  });

  it("converts markdown bold to <strong>", () => {
    const result = renderMarkdown("**bold text**");
    expect(result).toContain("<strong>bold text</strong>");
  });

  it("converts markdown links to <a> tags", () => {
    const result = renderMarkdown("[link](https://example.com)");
    expect(result).toContain('<a href="https://example.com">link</a>');
  });

  it("sanitizes script tags", () => {
    const result = renderMarkdown("<script>alert('xss')</script>");
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("alert");
  });

  it("sanitizes event handler attributes", () => {
    const result = renderMarkdown('<img onerror="alert(1)" src="x">');
    expect(result).not.toContain("onerror");
  });

  it("preserves code blocks", () => {
    const result = renderMarkdown("```\nconst x = 1;\n```");
    expect(result).toContain("<code>");
    expect(result).toContain("const x = 1;");
  });
});
