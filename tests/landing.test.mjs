import { describe, expect, it } from "vitest";
import { serveLandingRequest } from "../scripts/landing.mjs";

async function request(path, method = "GET") {
  const headers = new Map();
  const res = {
    statusCode: 0,
    headersSent: false,
    body: "",
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(body) { this.body = body?.toString() ?? ""; this.headersSent = true; },
  };
  const handled = await serveLandingRequest({ method }, res, new URL(path, "http://localhost"));
  return { ...res, headers, handled };
}

describe("public outreach routes", () => {
  it.each(["/", "/index.html", "/share", "/share/"])("keeps campaign attribution in every class link on %s", async (path) => {
    const response = await request(`${path}?ref=outreach-discord-v1&rh_source=discord&rh_campaign=outreach-v1&rh_landing=default&rh_entry=viewer&token=private-token&email=person@example.com`);
    expect(response.statusCode).toBe(200);
    const links = [...response.body.matchAll(/href="(\/api\/apps\/ruby-high\/viewer[^"]*)"/g)];
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const [, href] of links) {
      const url = new URL(href.replaceAll("&amp;", "&"), "http://localhost");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        ref: "outreach-discord-v1", rh_source: "discord", rh_campaign: "outreach-v1", rh_landing: "default", rh_entry: "viewer",
      });
    }
    expect(response.body).not.toContain("private-token");
    expect(response.body).not.toContain("person@example.com");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("bounds reflected values and keeps active markup out of the response", async () => {
    const params = new URLSearchParams({
      ref: '\"><script>alert(1)</script>',
      rh_source: "x".repeat(33),
      rh_campaign: "person@example.com",
      rh_landing: "default&token=secret",
      rh_entry: "../../admin",
    });
    const response = await request(`/?${params}`);
    expect(response.body).toContain('href="/api/apps/ruby-high/viewer"');
    expect(response.body).not.toContain("alert(1)");
    expect(response.body).not.toContain("person@example.com");
    expect(response.body).not.toContain("token=secret");
  });

  it("keeps normal class links and page metadata stable for direct visitors", async () => {
    const response = await request("/");
    expect(response.body).toContain('href="/api/apps/ruby-high/viewer"');
    expect(response.body).toContain('rel="canonical" href="https://ruby-high.ai/"');
    expect(response.body).toContain('href="/share"');
  });

  it.each([
    ["/share", "text/html"],
    ["/share/", "text/html"],
    ["/share.js", "text/javascript"],
    ["/share.css", "text/css"],
  ])("serves GET and HEAD for %s", async (path, type) => {
    const get = await request(path);
    const head = await request(path, "HEAD");
    expect(get.handled).toBe(true);
    expect(get.statusCode).toBe(200);
    expect(get.headers.get("content-type")).toContain(type);
    expect(get.body.length).toBeGreaterThan(0);
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe("");
    expect(head.headers).toEqual(get.headers);
  });

  it("leaves application routes and mutations with their existing handlers", async () => {
    expect((await request("/api/apps/ruby-high/viewer")).handled).toBe(false);
    expect((await request("/share", "POST")).handled).toBe(false);
    expect((await request("/private.json")).handled).toBe(false);
  });
});
