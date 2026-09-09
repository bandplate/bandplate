import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpMailer } from "./http.js";

describe("http-api mailer", () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchImpl = vi.fn();
  });

  it("posts to Resend's /emails endpoint with a bearer token and the expected body shape", async () => {
    fetchImpl.mockResolvedValue(new Response(null, { status: 200 }));
    const mailer = createHttpMailer({
      provider: "resend",
      apiKey: "re_test_key",
      from: "bandplate@example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await mailer.sendLoginLink("alex@example.com", "https://band.example/login/abc", {
      displayName: "Alex",
      expiresInMinutes: 15,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe("bandplate@example.com");
    expect(body.to).toEqual(["alex@example.com"]);
    expect(body.html).toContain("Alex");
    expect(body.html).toContain("https://band.example/login/abc");
  });

  it("posts to Postmark's /email endpoint with a server token header and the expected body shape", async () => {
    fetchImpl.mockResolvedValue(new Response(null, { status: 200 }));
    const mailer = createHttpMailer({
      provider: "postmark",
      apiKey: "pm_test_token",
      from: "bandplate@example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await mailer.send({ to: "alex@example.com", subject: "hi", text: "body" });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.postmarkapp.com/email");
    expect((init.headers as Record<string, string>)["X-Postmark-Server-Token"]).toBe(
      "pm_test_token",
    );
    const body = JSON.parse(init.body as string);
    expect(body.To).toBe("alex@example.com");
    expect(body.From).toBe("bandplate@example.com");
  });

  it("respects a custom baseUrl override, for pointing tests at a fake server", async () => {
    fetchImpl.mockResolvedValue(new Response(null, { status: 200 }));
    const mailer = createHttpMailer({
      provider: "resend",
      apiKey: "k",
      from: "bandplate@example.com",
      baseUrl: "http://localhost:9000/fake-resend",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await mailer.send({ to: "a@example.com", subject: "s", text: "t" });
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe("http://localhost:9000/fake-resend/emails");
  });

  it("throws (fails loudly) on a non-2xx provider response, since a swallowed failure would silently lock a Workers deploy out", async () => {
    fetchImpl.mockResolvedValue(
      new Response("bad request", { status: 422, statusText: "Unprocessable" }),
    );
    const mailer = createHttpMailer({
      provider: "resend",
      apiKey: "k",
      from: "bandplate@example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      mailer.sendLoginLink("alex@example.com", "https://band.example/login/abc"),
    ).rejects.toThrow(/422/);
  });

  it("escapes HTML-significant characters in displayName and url before interpolating into the HTML body", async () => {
    fetchImpl.mockResolvedValue(new Response(null, { status: 200 }));
    const mailer = createHttpMailer({
      provider: "resend",
      apiKey: "k",
      from: "bandplate@example.com",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await mailer.sendLoginLink("alex@example.com", 'https://band.example/login/abc?x=1&y="2"', {
      displayName: '<script>alert("hi")</script>',
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.text).toContain('<script>alert("hi")</script>');
  });
});
