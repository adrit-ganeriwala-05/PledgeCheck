// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CLINICS = [
  { id: "pr1", name: "Peachtree Dermatology", prescribers: ["Dr. Rivera"] },
  { id: "pr2", name: "Midtown Skin Clinic", prescribers: [] },
];

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  patientSignUp: vi.fn(),
  enrollPatient: vi.fn(),
  patientSignIn: vi.fn(),
  listClinics: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/lib/api/client", () => ({
  patientSignUp: mocks.patientSignUp,
  enrollPatient: mocks.enrollPatient,
  patientSignIn: mocks.patientSignIn,
  listClinics: mocks.listClinics,
}));

const { ENROLL_ERRORS, SIGNUP_ERRORS, SignupForm } = await import("./signup-form");
const { PatientSignInForm, SIGN_IN_COPY } = await import("./patient-sign-in-form");

/** The clinic list loads asynchronously, so the option must exist before it can be chosen. */
async function chooseClinic(id = "pr1") {
  const select = await screen.findByLabelText("Your clinic");
  await waitFor(() => expect(select.querySelector(`option[value="${id}"]`)).not.toBeNull());
  fireEvent.change(select, { target: { value: id } });
}

async function fill({ email = "new@example.test", password = "password123", clinic = "pr1" } = {}) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: password } });
  if (clinic) await chooseClinic(clinic);
  fireEvent.click(screen.getByRole("button", { name: /Create account|Link my account/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listClinics.mockResolvedValue({ ok: true, data: { clinics: CLINICS } });
});

describe("SignupForm", () => {
  it("signs up, joins the chosen clinic and opens the portal", async () => {
    mocks.patientSignUp.mockResolvedValue({ ok: true, data: { needsEmailConfirmation: false } });
    mocks.enrollPatient.mockResolvedValue({ ok: true, data: { patientId: "p1", pseudonym: "PT-9001" } });
    render(<SignupForm />);
    await fill();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/portal"));
    expect(mocks.patientSignUp).toHaveBeenCalledWith("new@example.test", "password123");
    expect(mocks.enrollPatient).toHaveBeenCalledWith("pr1");
  });

  it("names the prescribers so a patient recognises their own clinic", async () => {
    render(<SignupForm />);
    expect(await screen.findByRole("option", { name: "Peachtree Dermatology — Dr. Rivera" })).toBeInTheDocument();
    // A practice with no prescriber on file still lists, under its own name alone.
    expect(screen.getByRole("option", { name: "Midtown Skin Clinic" })).toBeInTheDocument();
  });

  it("says so when the clinic list cannot be loaded", async () => {
    mocks.listClinics.mockResolvedValue({ ok: false, error: { code: "server_error", status: 500 } });
    render(<SignupForm />);
    expect(await screen.findByText(/Could not load the clinic list/)).toBeInTheDocument();
  });

  it.each([
    ["unknown_practice", 404],
    ["already_enrolled", 409],
  ] as const)("explains %s, and a retry only repeats the clinic step", async (code, status) => {
    mocks.patientSignUp.mockResolvedValue({ ok: true, data: { needsEmailConfirmation: false } });
    mocks.enrollPatient
      .mockResolvedValueOnce({ ok: false, error: { code, status } })
      .mockResolvedValue({ ok: true, data: { patientId: "p1", pseudonym: "PT-9001" } });
    render(<SignupForm />);
    await fill();
    expect(await screen.findByRole("alert")).toHaveTextContent(ENROLL_ERRORS[code]);
    await chooseClinic("pr2");
    fireEvent.click(screen.getByRole("button", { name: "Link my account" }));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/portal"));
    // The account already exists, so only the clinic step runs again.
    expect(mocks.patientSignUp).toHaveBeenCalledTimes(1);
  });

  it("says when the email already has an account, with a sign-in link", async () => {
    mocks.patientSignUp.mockResolvedValue({ ok: false, error: { code: "email_taken", status: 400 } });
    render(<SignupForm />);
    await fill();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(SIGNUP_ERRORS.email_taken);
    expect(alert.querySelector('a[href="/portal/login"]')).not.toBeNull();
    expect(alert).not.toHaveTextContent("new@example.test");
    expect(mocks.enrollPatient).not.toHaveBeenCalled();
  });

  it("shows 'check your email' when confirmation is on", async () => {
    mocks.patientSignUp.mockResolvedValue({ ok: true, data: { needsEmailConfirmation: true } });
    render(<SignupForm />);
    await fill();
    expect(await screen.findByRole("heading", { name: "Check your email to confirm your account" })).toBeInTheDocument();
    expect(mocks.enrollPatient).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).not.toHaveTextContent("new@example.test");
  });

  it("checks the password length and the clinic before calling anything", async () => {
    render(<SignupForm />);
    await fill({ password: "short" });
    expect(await screen.findByRole("alert")).toHaveTextContent(SIGNUP_ERRORS.weak_password);
    expect(mocks.patientSignUp).not.toHaveBeenCalled();
  });

  it("will not submit without a clinic chosen", async () => {
    render(<SignupForm />);
    await screen.findByLabelText("Your clinic");
    await fill({ clinic: "" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose the clinic that treats you");
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
