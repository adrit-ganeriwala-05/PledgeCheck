// @vitest-environment jsdom
import { configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

configure({ asyncUtilTimeout: 5000 });

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  setNewPassword: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/lib/api/client", () => ({ setNewPassword: mocks.setNewPassword }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: mocks.getSession, onAuthStateChange: mocks.onAuthStateChange },
  }),
}));

const { ResetPasswordForm, RESET_COPY } = await import("./reset-password-form");

/** The recovery link put a session in place (or did not). */
function session(present: boolean) {
  mocks.getSession.mockResolvedValue({ data: { session: present ? { user: { id: "u1" } } : null } });
}

function fill(password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: "Set password" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } });
  mocks.setNewPassword.mockResolvedValue({ ok: true, data: null });
});

describe("ResetPasswordForm", () => {
  it("offers the form once the recovery link has signed the patient in", async () => {
    session(true);
    render(<ResetPasswordForm />);
    expect(await screen.findByRole("heading", { name: RESET_COPY.title })).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
  });

  it("sets the password and sends the patient to their portal", async () => {
    session(true);
    render(<ResetPasswordForm />);
    await screen.findByLabelText("New password");

    fill("a-good-password");
    await waitFor(() => expect(mocks.setNewPassword).toHaveBeenCalledWith("a-good-password"));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/portal"));
  });

  it("will not submit two passwords that differ, and never calls Supabase", async () => {
    session(true);
    render(<ResetPasswordForm />);
    await screen.findByLabelText("New password");

    fill("a-good-password", "a-different-one");
    expect(await screen.findByText(RESET_COPY.mismatch)).toBeInTheDocument();
    expect(mocks.setNewPassword).not.toHaveBeenCalled();
  });

  it("refuses a password under the minimum without calling Supabase", async () => {
    session(true);
    render(<ResetPasswordForm />);
    await screen.findByLabelText("New password");

    fill("short");
    expect(await screen.findByText(RESET_COPY.weak)).toBeInTheDocument();
    expect(mocks.setNewPassword).not.toHaveBeenCalled();
  });

  it("says the link is dead when it carried no session, and offers sign-in", async () => {
    session(false);
    render(<ResetPasswordForm />);
    // The screen waits briefly for a session still in flight before giving up.
    expect(await screen.findByRole("heading", { name: RESET_COPY.deadTitle })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/portal/login");
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("takes the session from PASSWORD_RECOVERY when it lands after the first check", async () => {
    session(false);
    let notify: ((event: string, s: unknown) => void) | null = null;
    mocks.onAuthStateChange.mockImplementation((cb: (event: string, s: unknown) => void) => {
      notify = cb;
      return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
    });

    render(<ResetPasswordForm />);
    await waitFor(() => expect(notify).not.toBeNull());
    notify!("PASSWORD_RECOVERY", { user: { id: "u1" } });

    expect(await screen.findByLabelText("New password")).toBeInTheDocument();
  });

  it("explains an expired session rather than looking like a save", async () => {
    session(true);
    mocks.setNewPassword.mockResolvedValue({ ok: false, error: { code: "no_session", status: 401 } });
    render(<ResetPasswordForm />);
    await screen.findByLabelText("New password");

    fill("a-good-password");
    expect(await screen.findByText(RESET_COPY.noSession)).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("says so when the new password is the current one", async () => {
    session(true);
    mocks.setNewPassword.mockResolvedValue({ ok: false, error: { code: "same_password", status: 422 } });
    render(<ResetPasswordForm />);
    await screen.findByLabelText("New password");

    fill("a-good-password");
    expect(await screen.findByText(RESET_COPY.samePassword)).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
