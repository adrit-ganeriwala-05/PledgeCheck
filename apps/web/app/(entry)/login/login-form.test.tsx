// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ signInWithPassword: vi.fn(), replace: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword: mocks.signInWithPassword } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));

const { BAD_CREDENTIALS, LoginForm, UNREACHABLE } = await import("./login-form");

function submit(email = "staff1@example.test", password = "secret") {
  render(<LoginForm />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: ` ${email} ` } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  mocks.signInWithPassword.mockReset();
  mocks.replace.mockReset();
});

describe("LoginForm", () => {
  it("signs in with the trimmed email and continues to role routing", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    submit();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login/continue"));
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: "staff1@example.test", password: "secret" });
  });

  it.each(["Invalid login credentials", "Email not confirmed", "User is banned"])(
    "shows the same generic message for %j",
    async (message) => {
      mocks.signInWithPassword.mockResolvedValue({ data: {}, error: { message } });
      submit();
      expect(await screen.findByRole("alert")).toHaveTextContent(BAD_CREDENTIALS);
      expect(screen.queryByText(message)).not.toBeInTheDocument();
      expect(mocks.replace).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    },
  );

  it("reports a network failure separately", async () => {
    mocks.signInWithPassword.mockRejectedValue(new TypeError("fetch failed"));
    submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(UNREACHABLE);
  });

  it("disables the button while signing in", async () => {
    mocks.signInWithPassword.mockReturnValue(new Promise(() => {}));
    submit();
    expect(await screen.findByRole("button", { name: "Signing in…" })).toBeDisabled();
  });
});
