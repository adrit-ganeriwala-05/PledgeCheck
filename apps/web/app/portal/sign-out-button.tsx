import { Button } from "@/components/ui/button";

/** Plain form POST, so signing out works without client JavaScript. */
export function PortalSignOutButton() {
  return (
    <form action="/portal/sign-out" method="post">
      <Button type="submit" variant="outline" size="sm">
        Sign out
      </Button>
    </form>
  );
}
