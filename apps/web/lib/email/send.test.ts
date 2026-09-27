import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmailSendError, sendEmail } from "./send";

const message = { to: "p@example.com", subject: "s", html: "<p>h</p>", text: "t" };

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test_key");
  vi.stubEnv("EMAIL_FROM", "PledgeCheck <links@pledgecheck.tech>");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sendEmail", () => {
  it("posts the message to Resend and returns its id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "msg_1" }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await sendEmail(message)).toEqual({ id: "msg_1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test_key");
    expect(JSON.parse(init.body)).toEqual({
      from: "PledgeCheck <links@pledgecheck.tech>",
      to: ["p@example.com"],
      subject: "s",
      html: "<p>h</p>",
      text: "t",
    });
  });

  it("throws EmailSendError with Resend's reason when rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ message: "domain not verified" }, { status: 403 })),
    );
    await expect(sendEmail(message)).rejects.toThrow("email rejected (403): domain not verified");
  });

  it("throws EmailSendError when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(sendEmail(message)).rejects.toBeInstanceOf(EmailSendError);
  });

  it("throws before sending when the key is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendEmail(message)).rejects.toThrow(/RESEND_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
