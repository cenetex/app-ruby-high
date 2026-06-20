import { describe, expect, it, vi } from "vitest";
import { createChatMessageRenderer } from "../viewer-parts/chat-messages.js";

class FakeElement {
  className = "";
  textContent = "";
  title = "";
  type = "";
  src = "";
  alt = "";
  parentNode: FakeElement | null = null;
  children: FakeElement[] = [];
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  listeners = new Map<string, (event: Event) => void>();
  style = {
    background: "",
  };
  onerror: (() => void) | null = null;

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeElement): FakeElement {
    this.children = this.children.filter((candidate) => candidate !== child);
    child.parentNode = null;
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(name: string, listener: (event: Event) => void): void {
    this.listeners.set(name, listener);
  }
}

function createDocument() {
  return {
    createElement(tagName: string) {
      return new FakeElement(tagName) as unknown as HTMLElement;
    },
  };
}

function textTree(node: FakeElement): string[] {
  return [
    node.textContent,
    ...node.children.flatMap((child) => textTree(child)),
  ].filter(Boolean);
}

function renderer() {
  const markdownCalls: Array<{ el: FakeElement; markdown: string }> = [];
  return {
    markdownCalls,
    renderer: createChatMessageRenderer({
      document: createDocument(),
      sanitizeVisibleChatText(input) {
        return input.replace(/bad/gi, "good");
      },
      renderMarkdownInto(el, markdown) {
        markdownCalls.push({ el: el as unknown as FakeElement, markdown });
        (el as unknown as FakeElement).textContent = `md:${markdown}`;
      },
    }),
  };
}

describe("chat message renderer", () => {
  it("renders role-tagged markdown messages with avatar images", () => {
    const { renderer: r, markdownCalls } = renderer();

    const rendered = r.buildMessage({
      kind: "teacher",
      name: "Ruby",
      body: "bad answer",
      color: "#c00",
      avatarUrl: "/ruby-face.png",
    });
    const wrap = rendered.wrap as unknown as FakeElement;

    expect(wrap.className).toBe("msg teacher");
    expect(textTree(wrap)).toEqual(["Ruby", "Teacher", expect.any(String), "md:good answer"]);
    const avatar = wrap.children[0]!;
    expect(avatar.className).toBe("avatar is-teacher");
    expect(avatar.style.background).toBe("#fff");
    expect(avatar.children[0]!.src).toBe("/ruby-face.png");
    expect(avatar.children[0]!.alt).toBe("Ruby");
    expect(rendered.body).toBe(wrap.children[2] as unknown as HTMLElement);
    expect((rendered.body as unknown as FakeElement).dataset.markdownRaw).toBe("good answer");
    expect(markdownCalls.map((call) => call.markdown)).toEqual(["good answer"]);
  });

  it("falls back to initials when avatar images fail", () => {
    const { renderer: r } = renderer();
    const wrap = r.buildMessage({
      kind: "student",
      name: "Noor",
      body: "hello",
      color: "#0c0",
      avatarUrl: "/missing.png",
    }).wrap as unknown as FakeElement;
    const avatar = wrap.children[0]!;
    const img = avatar.children[0]!;

    img.onerror?.();

    expect(avatar.children).toEqual([]);
    expect(avatar.style.background).toBe("#0c0");
    expect(avatar.textContent).toBe("N");
  });

  it("renders system, tool, and empty-state rows", () => {
    const { renderer: r } = renderer();
    const cta = vi.fn();

    expect(textTree(r.buildSystem("Saved") as unknown as FakeElement)).toEqual(["Saved"]);
    expect((r.buildSystem("Saved") as unknown as FakeElement).className).toBe("msg system");
    expect((r.buildTool("Tool ran") as unknown as FakeElement).className).toBe("msg tool");

    const empty = r.buildEmptyState({
      title: "<Welcome>",
      body: "Pick a class",
      ctaLabel: "Start",
      ctaAction: cta,
      heroSrc: "/ruby.png",
    }) as unknown as FakeElement;

    expect(empty.className).toBe("empty-state");
    expect(empty.children.map((child) => child.tagName)).toEqual(["img", "h2", "p", "button"]);
    expect(empty.children[0]!.src).toBe("/ruby.png");
    expect(textTree(empty)).toEqual(["<Welcome>", "Pick a class", "Start"]);
    empty.children[3]!.listeners.get("click")?.(new Event("click"));
    expect(cta).toHaveBeenCalledTimes(1);
  });
});
