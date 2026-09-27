// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { AnchorNowButton } from "./anchor-button";
import { AuditScreen } from "./audit-screen";
import { ChainTable } from "./chain-table";
import { HONESTY_FOOTNOTE } from "./format";
import type { AnchorItem, ChainPage, ChainRow, VerifyResponse } from "./types";
import { VerifyPanel } from "./verify-panel";

const SIG = "5".repeat(88); // test vector
const EXPLORER = `https://explorer.solana.com/tx/${SIG}?cluster=devnet`;
const H = (c: string) => c.repeat(64); // test vectors

function row(seq: number): ChainRow {
  return {
    seq,
    createdAt: new Date(Date.UTC(2026, 8, 26, 20, seq)).toISOString(),
    actor: "system",
    action: "review.approved",
    refId: "a3000000-0000-0000-0000-000000000001",
    prevHash: H("0"),
    hash: H(String(seq % 10)),
  };
}

function chainOf(seqs: number[], extra: Partial<ChainPage> = {}): ChainPage {
  return { rows: seqs.map(row), page: 1, pageCount: 1, total: seqs.length, ...extra };
}

function verifyResult(over: Partial<VerifyResponse>): VerifyResponse {
  return {
    ok: false,
    headSeq: 20,
    headHash: H("a"),
    anchoredHash: H("a"),
    match: true,
    status: "intact",
    reason: null,
    firstBrokenSeq: null,
    tamperedWithin: null,
    checkedRows: 25,
    unanchoredCount: 5,
    dbCopyMatches: true,
    anchor: { signature: SIG, explorerUrl: EXPLORER, anchoredAt: "2026-09-26T20:00:00.000Z" },
    anchorsChecked: [{ headSeq: 20, match: true, status: "intact", reason: null, explorerUrl: EXPLORER }],
    ...over,
  };
}

const ANCHOR: AnchorItem = { headSeq: 20, headHash: H("a"), signature: SIG, explorerUrl: EXPLORER, anchoredAt: "2026-09-26T20:00:00.000Z" };

let fetchMock: ReturnType<typeof vi.fn>;
function reply(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  router.push.mockReset();
  router.refresh.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("VerifyPanel", () => {
  it("intact: green, with the anchor seq and an explorer link", () => {
    render(<VerifyPanel result={verifyResult({ ok: true })} />);
    const panel = screen.getByRole("status", { name: "Verification result" });
    expect(panel).toHaveAttribute("data-tone", "ok");
    expect(panel).toHaveTextContent("Verified: Log unchanged since last anchor (seq 20)");
    const link = within(panel).getByRole("link", { name: /seq 20 on Solana Explorer/ });
    expect(link).toHaveAttribute("href", EXPLORER);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("tampered: red alert naming the seq and the reason in plain words", () => {
    render(<VerifyPanel result={verifyResult({ status: "tampered", reason: "hash_mismatch", firstBrokenSeq: 17, match: false })} />);
    const panel = screen.getByRole("alert", { name: "Verification result" });
    expect(panel).toHaveAttribute("data-tone", "bad");
    expect(panel).toHaveTextContent("Tampered: Tampering detected at seq 17");
    expect(panel).toHaveTextContent("contents were changed after it was written");
  });

  it("tampered (sophisticated insider): names the range", () => {
    render(
      <VerifyPanel
        result={verifyResult({ status: "tampered", reason: "anchor_mismatch", tamperedWithin: { fromSeq: 11, toSeq: 20 }, match: false })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Tampering detected between seq 11 and 20");
    expect(screen.getByRole("alert")).toHaveTextContent("no longer matches the fingerprint recorded on Solana");
  });

  it("unverifiable: amber, never worded as tampering", () => {
    const { rerender } = render(<VerifyPanel result={verifyResult({ status: "unverifiable", reason: "solana_unreachable" })} />);
    let panel = screen.getByRole("status");
    expect(panel).toHaveAttribute("data-tone", "warn");
    expect(panel).toHaveTextContent("Not verified: Could not reach Solana — log not verified");
    expect(panel).not.toHaveTextContent(/tamper/i);

    rerender(<VerifyPanel result={verifyResult({ status: "unverifiable", reason: "wrong_fee_payer" })} />);
    panel = screen.getByRole("status");
    expect(panel).toHaveTextContent("Could not verify against Solana — log not verified");
    expect(panel).toHaveTextContent("not sent by PledgeCheck's wallet");
  });

  it("no_anchor: grey, prompts Anchor now", () => {
    render(<VerifyPanel result={verifyResult({ status: "no_anchor", headSeq: null, anchor: null, anchorsChecked: [] })} />);
    const panel = screen.getByRole("status");
    expect(panel).toHaveAttribute("data-tone", "none");
    expect(panel).toHaveTextContent("Not anchored: Not anchored yet");
    expect(panel).toHaveTextContent("Click Anchor now");
    expect(within(panel).queryByRole("link")).toBeNull();
  });

  it("notes an edited database copy of an anchor", () => {
    render(<VerifyPanel result={verifyResult({ ok: true, dbCopyMatches: false })} />);
    expect(screen.getByRole("status")).toHaveTextContent("database copy of an anchor was edited");
  });
});

describe("AnchorNowButton", () => {
  it("shows a pending state, then the new anchor with its explorer link", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    const onAnchored = vi.fn();
    render(<AnchorNowButton onAnchored={onAnchored} />);

    fireEvent.click(screen.getByRole("button", { name: "Anchor now" }));
    const pending = await screen.findByRole("button", { name: "Anchoring…" });
    expect(pending).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledWith("/api/anchors", { method: "POST" });

    const body = { signature: SIG, explorerUrl: EXPLORER, headSeq: 30, headHash: H("b"), reused: false };
    resolve(new Response(JSON.stringify(body), { status: 200 }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Anchored seq 30 on Solana.");
    expect(within(status).getByRole("link", { name: /View on Solana Explorer/ })).toHaveAttribute("href", EXPLORER);
    expect(onAnchored).toHaveBeenCalledWith(body);
  });

  it("says Already anchored for a reused result", async () => {
    fetchMock.mockReturnValue(reply(200, { signature: SIG, explorerUrl: EXPLORER, headSeq: 20, headHash: H("a"), reused: true }));
    render(<AnchorNowButton />);
    fireEvent.click(screen.getByRole("button", { name: "Anchor now" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Already anchored at seq 20.");
  });

  it.each([
    [502, { error: "wallet_needs_devnet_sol" }, "out of devnet SOL"],
    [502, { error: "solana_unavailable" }, "Solana could not be reached"],
    [409, { error: "nothing_to_anchor" }, "no audit events to anchor"],
    [500, { error: "solana_not_configured" }, "not configured"],
  ])("shows an error for %s %j with a retry", async (status, body, text) => {
    fetchMock.mockReturnValue(reply(status, body));
    render(<AnchorNowButton />);
    fireEvent.click(screen.getByRole("button", { name: "Anchor now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.getByRole("button", { name: "Try anchoring again" })).toBeEnabled();
  });

  it("keeps the explorer link when the anchor was sent but not recorded", async () => {
    fetchMock.mockReturnValue(reply(500, { error: "anchor_not_recorded", signature: SIG, explorerUrl: EXPLORER }));
    render(<AnchorNowButton />);
    fireEvent.click(screen.getByRole("button", { name: "Anchor now" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("sent to Solana but not saved");
    expect(within(alert).getByRole("link")).toHaveAttribute("href", EXPLORER);
  });

  it("reports a network error", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    render(<AnchorNowButton />);
    fireEvent.click(screen.getByRole("button", { name: "Anchor now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network error");
  });
});

describe("ChainTable", () => {
  it("shows the empty state", () => {
    render(<ChainTable chain={chainOf([])} anchoredSeqs={new Set()} highlightSeq={null} />);
    expect(screen.getByText("No audit events yet.")).toBeInTheDocument();
  });

  it("shows short hashes with the full value, the anchored marker and the broken row", () => {
    render(<ChainTable chain={chainOf([3, 2, 1])} anchoredSeqs={new Set([2])} highlightSeq={3} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);

    const broken = rows[0];
    expect(broken).toHaveAttribute("id", "seq-3");
    expect(broken).toHaveAttribute("aria-current", "true");
    expect(broken).toHaveTextContent("Tampered");

    const hash = within(rows[1]).getByLabelText(`Hash ${H("2")}`);
    expect(hash).toHaveTextContent("2222222222");
    expect(hash).toHaveAttribute("title", H("2"));
    expect(rows[1]).toHaveTextContent("Anchored");
    expect(rows[2]).not.toHaveTextContent("Anchored");
    expect(rows[1]).not.toHaveAttribute("aria-current");
  });

  it("pages newest first with Newer / Older links", () => {
    render(<ChainTable chain={chainOf([60, 59], { page: 2, pageCount: 3, total: 120 })} anchoredSeqs={new Set()} highlightSeq={null} />);
    const nav = screen.getByRole("navigation", { name: "Audit log pages" });
    expect(nav).toHaveTextContent("Page 2 of 3 · 120 events");
    expect(within(nav).getByRole("link", { name: "Newer" })).toHaveAttribute("href", "/audit?page=1");
    expect(within(nav).getByRole("link", { name: "Older" })).toHaveAttribute("href", "/audit?page=3");
  });
});

describe("AuditScreen", () => {
  it("shows the unanchored count and the anchors list", () => {
    render(<AuditScreen chain={chainOf([2, 1])} anchors={[ANCHOR]} unanchoredCount={5} />);
    expect(screen.getByText("5 events not yet anchored")).toBeInTheDocument();
    const list = screen.getByRole("list");
    expect(within(list).getByRole("link", { name: /Explorer/ })).toHaveAttribute("href", EXPLORER);
  });

  it("highlights and scrolls to the broken row after a tampered result", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    fetchMock.mockReturnValue(reply(200, verifyResult({ status: "tampered", reason: "hash_mismatch", firstBrokenSeq: 2, match: false })));
    render(<AuditScreen chain={chainOf([3, 2, 1])} anchors={[]} unanchoredCount={3} />);

    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert", { name: "Verification result" })).toHaveTextContent("Tampering detected at seq 2");
    const broken = document.getElementById("seq-2")!;
    expect(broken).toHaveAttribute("aria-current", "true");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.contexts[0]).toBe(broken);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("opens the page holding the broken row when it isn't on this page", async () => {
    fetchMock.mockReturnValue(reply(200, verifyResult({ status: "tampered", reason: "hash_mismatch", firstBrokenSeq: 7, match: false })));
    render(<AuditScreen chain={chainOf([100, 99])} anchors={[]} unanchoredCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/audit?seq=7", { scroll: false }));
  });

  it("shows a verify error with a working retry", async () => {
    fetchMock.mockReturnValueOnce(reply(500, { error: "verify_failed" }));
    fetchMock.mockReturnValueOnce(reply(200, verifyResult({ ok: true })));
    render(<AuditScreen chain={chainOf([1])} anchors={[]} unanchoredCount={0} />);

    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not verify the log. Try again.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("status", { name: "Verification result" })).toHaveTextContent("Log unchanged");
    expect(fetchMock).toHaveBeenCalledWith("/api/audit/verify", { cache: "no-store" });
  });

  it("refreshes the page data after a successful anchor", async () => {
    fetchMock.mockReturnValue(reply(200, { signature: SIG, explorerUrl: EXPLORER, headSeq: 1, headHash: H("a"), reused: false }));
    render(<AuditScreen chain={chainOf([1])} anchors={[]} unanchoredCount={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Anchor now" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  });

  it("footnote text states what the anchor does and doesn't prove", () => {
    expect(HONESTY_FOOTNOTE).toMatch(/hasn't been edited since it was anchored/);
    expect(HONESTY_FOOTNOTE).toMatch(/doesn't validate test photos/);
    expect(HONESTY_FOOTNOTE).toMatch(/Only a hash is stored on-chain/);
  });
});
