// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ replace: vi.fn(), patientSignUp: vi.fn(), enrollPatient: vi.fn(), patientSignIn: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/lib/api/client", () => ({
  patientSignUp: mocks.patientSignUp,
  enrollPatient: mocks.enrollPatient,
  patientSignIn: mocks.patientSignIn,
}));

const { ENROLL_ERRORS, SIGNUP_ERRORS, SignupForm } = await import("./signup-form");
const { PatientSignInForm, SIGN_IN_COPY } = await import("./patient-sign-in-form");

function fill({ email = "new@example.test", password = "password123", code = "K4M9-TQ2P" } = {}) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: password } });
  fireEvent.change(screen.getByLabelText(/^Enrollment code/), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
}

beforeEach(() => vi.clearAllMocks());

describe("SignupForm", () => {
  it("signs up, enrolls with the code and opens the portal", async () => {
    mocks.patientSignUp.mockResolvedValue({ ok: true, data: { needsEmailConfirmation: false } });
    mocks.enrollPatient.mockResolvedValue({ ok: true, data: { patientId: "p1" } });
    render(<SignupForm />);
    fill();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/portal"));
    expect(mocks.patientSignUp).toHaveBeenCalledWith("new@example.test", "password123");
    expect(mocks.enrollPatient).toHaveBeenCalledWith("K4M9-TQ2P");
  });

  it.each([
    ["invalid_code", 404],
    ["expired_code", 410],
    ["already_enrolled", 409],
  ] as const)("explains %s, and a retry only repeats the code step", async (code, status) => {
    mocks.patientSignUp.mockResolvedValue({ ok: true, data: { needsEmailConfirmation: false } });
    mocks.enrollPatient.mockResolvedValueOnce({ ok: false, error: { code, status } }).mockResolvedValue({ ok: true, data: { patientId: "p1" } });
    render(<SignupForm />);
    fill();
    expect(await screen.findByRole("alert")).toHaveTextContent(ENROLL_ERRORS[code]);
    fireEvent.change(screen.getByLabelText(/^Enrollment code/), { target: { value: "ABCD1234" } });
    fireEvent.click(screen.getByRole("button", { name: "Link my account" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/portal"));
    expect(mocks.patientSignUp).toHaveBeenCalledTimes(1);
  });

  it("says when the email already has an account, with a sign-in link", async () => {
    mocks.patientSignUp.mockResolvedValue({ ok: false, error: { code: "email_taken", status: 400 } });
    render(<SignupForm />);
    fill();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(SIGNUP_ERRORS.email_taken);
    expect(alert.querySelector('a[href="/portal/login"]')).not.toBeNull();
    expect(alert).not.toHaveTextContent("new@example.test");
    expect(mocks.enrollPatient).not.toHaveBeenCalled();
  });

  it("shows 'check your email' when confirmation is on", async () => {
    mocks.patientSignUp.mockResolvedValue({ ok: true, data: { needsEmailConfirmation: true } });
    render(<SignupForm />);
    fill();
    expect(await screen.findByRole("heading", { name: "Check your email to confirm your account" })).toBeInTheDocument();
    expect(mocks.enrollPatient).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).not.toHaveTextContent("new@example.test");
  });

  it("checks the password length and the code before calling anything", async () => {
    render(<SignupForm />);
    fill({ password: "short" });
    expect(await screen.findByRole("alert")).toHaveTextContent(SIGNUP_ERRORS.weak_password);
    fill({ code: "" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the enrollment code");
    expect(mocks.patientSignUp).not.toHaveBeenCalled();
  });
});

describe("PatientSignInForm", () => {
  it("goes to the validated next path", async () => {
    mocks.patientSignIn.mockResolvedValue({ ok: true, data: null });
    render(<PatientSignInForm next="/portal" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/portal"));
  });

  it("uses one message for every credential failure", async () => {
    mocks.patientSignIn.mockResolvedValue({ ok: false, error: { code: "bad_credentials", status: 400 } });
    render(<PatientSignInForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(SIGN_IN_COPY.badCredentials);
  });

  it("calls back instead of navigating when used inline", async () => {
    mocks.patientSignIn.mockResolvedValue({ ok: true, data: null });
    const onSignedIn = vi.fn();
    render(<PatientSignInForm onSignedIn={onSignedIn} showSignUpLink={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Create your account" })).not.toBeInTheDocument();
  });
});
