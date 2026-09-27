import type { Metadata } from "next";

import { PortalHome } from "@/components/portal/portal-home";

export const metadata: Metadata = { title: "Your portal · PledgeCheck" };

export default function PortalPage() {
  return <PortalHome />;
}
