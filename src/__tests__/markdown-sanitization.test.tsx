/**
 * Unit tests for Markdown sanitization.
 * Verifies that XSS vectors are stripped and safe content renders correctly.
 */

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownContent } from "@/components/markdown-content";

function render(content: string): string {
  return renderToStaticMarkup(createElement(MarkdownContent, { content }));
}

describe("MarkdownContent – safe rendering", () => {
  it("renders bold text", () => {
    const html = render("**bold**");
    expect(html).toMatch(/<strong[\s>]/);
    expect(html).toContain("bold");
  });

  it("renders italic text", () => {
    const html = render("_italic_");
    expect(html).toMatch(/<em[\s>]/);
  });

  it("renders a safe link", () => {
    const html = render("[example](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("example");
  });

  it("renders bullet lists", () => {
    const html = render("- item one\n- item two");
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    expect(html).toContain("item one");
  });

  it("renders inline code", () => {
    const html = render("`const x = 1`");
    expect(html).toContain("<code");
    expect(html).toContain("const x = 1");
  });

  it("renders blockquotes", () => {
    const html = render("> quoted text");
    expect(html).toContain("<blockquote");
    expect(html).toContain("quoted text");
  });
});

describe("MarkdownContent – XSS sanitization", () => {
  it("strips <script> tags", () => {
    const html = render('<script>alert("xss")</script>');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(");
  });

  it("strips javascript: URLs in links", () => {
    const html = render("[click me](javascript:alert(\"xss\"))");
    expect(html).not.toContain("javascript:");
  });

  it("strips onerror event handlers on inline HTML", () => {
    const html = render('<img src="x" onerror="alert(1)"/>');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("alert(1)");
  });

  it("strips onclick event handlers on inline HTML", () => {
    const html = render('<a href="#" onclick="alert(1)">click</a>');
    expect(html).not.toContain("onclick");
  });

  it("strips <iframe> tags", () => {
    const html = render('<iframe src="https://evil.com"></iframe>');
    expect(html).not.toContain("<iframe");
  });

  it("strips <object> tags", () => {
    const html = render('<object data="https://evil.com"></object>');
    expect(html).not.toContain("<object");
  });

  it("strips data: URIs in links", () => {
    const html = render("[x](data:text/html,<script>alert(1)</script>)");
    expect(html).not.toContain("data:");
  });

  it("does not execute embedded scripts in image attributes", () => {
    const html = render('<img src="javascript:alert(1)"/>');
    expect(html).not.toContain("javascript:");
  });
});

describe("MarkdownContent – link attributes", () => {
  it("adds rel=nofollow to external links", () => {
    const html = render("[link](https://example.com)");
    expect(html).toContain("nofollow");
  });

  it("adds noopener noreferrer to external links", () => {
    const html = render("[link](https://example.com)");
    expect(html).toContain("noopener");
    expect(html).toContain("noreferrer");
  });

  it("opens external links in a new tab", () => {
    const html = render("[link](https://example.com)");
    expect(html).toContain('target="_blank"');
  });
});

describe("MarkdownContent – plain text compatibility", () => {
  it("renders plain text without wrapping in complex HTML", () => {
    const html = render("Hello, world!");
    expect(html).toContain("Hello, world!");
  });

  it("preserves line breaks with remark-breaks", () => {
    const html = render("line one\nline two");
    // remark-breaks turns single newlines into <br> elements
    expect(html).toContain("line one");
    expect(html).toContain("line two");
  });
});
