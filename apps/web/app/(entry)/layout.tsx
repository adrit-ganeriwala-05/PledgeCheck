import { EntryShell } from "@/components/entry/entry-shell";

// Home and the sign-in pages share this layout, so it (and the 3D stage in it) persists across
// navigation between them. Route groups don't change URLs.
export default function EntryLayout({ children }: LayoutProps<"/">) {
  return <EntryShell>{children}</EntryShell>;
}
