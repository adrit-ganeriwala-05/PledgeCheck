"use client";

// Pending refill requests, and the two things staff can do with one. Owner: Labib.
//
// The patient's request sits here until a clinician acts. Approving issues a test link
// and emails it; it does not approve a prescription, which still needs a negative test
// read by both readers and approved by a prescriber.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

export type PendingRefill = {
  id: string;
  pseudonym: string;
  createdAt: string;
  contactEmail: string | null;
};

const ERRORS: Record<string, string> = {
  already_decided: "Someone else already answered this request.",
  home_testing_not_allowed: "This patient is not cleared for home testing.",
  not_found: "That request is no longer available.",
  issue_failed: "Could not issue the test link.",
  audit_failed: "The link was not issued: the audit log could not be written.",
  decision_failed: "Could not save the decision.",
};

export function RefillQueue({ refills }: { refills: PendingRefill[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<Record<string, string>>({});

  function decide(id: string, payload: Record<string, unknown>) {
    setMessages((m) => ({ ...m, [id]: "" }));
    startTransition(async () => {
      try {
        const response = await fetch(`/api/refills/${id}/decision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          link?: string;
          emailed?: boolean;
        };
        if (!response.ok) {
          setMessages((m) => ({ ...m, [id]: ERRORS[data.error ?? ""] ?? "Could not save the decision." }));
          return;
        }
        if (data.link) {
          // Shown once. If the email did not send, this is the only copy.
          setLinks((l) => ({ ...l, [id]: data.link as string }));
          setMessages((m) => ({
            ...m,
            [id]: data.emailed ? "Link emailed to the patient." : "Email not sent — copy the link below.",
          }));
        }
        router.refresh();
      } catch {
        setMessages((m) => ({ ...m, [id]: "Could not reach the server." }));
      }
    });
  }

  if (refills.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Refill requests</h2>
      <ul className="divide-y rounded-md border">
        {refills.map((r) => (
          <li key={r.id} className="space-y-2 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{r.pseudonym}</span>
              <span className="text-sm text-muted-foreground">
                {new Date(r.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
              </span>
            </div>
            {!r.contactEmail && (
              <p className="text-sm text-muted-foreground">
                No email on file — approving will show the link here instead of sending it.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={pending} onClick={() => decide(r.id, { decision: "approve", setting: "home" })}>
                Approve and send test link
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  const reason = window.prompt("Reason for declining (the patient sees this):");
                  if (reason && reason.trim()) decide(r.id, { decision: "decline", reason: reason.trim() });
                }}
              >
                Decline
              </Button>
            </div>
            {messages[r.id] && (
              <p role="status" className="text-sm">
                {messages[r.id]}
              </p>
            )}
            {links[r.id] && (
              <code className="block rounded bg-muted p-2 text-xs break-all">{links[r.id]}</code>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
