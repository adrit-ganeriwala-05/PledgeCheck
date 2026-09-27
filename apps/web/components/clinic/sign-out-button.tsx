import { LogOutIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Plain form POST, so sign-out works without client JavaScript. */
export function SignOutButton() {
  return (
    <form action="/login/sign-out" method="post">
      <Button type="submit" variant="outline" size="sm" className="px-2 sm:px-2.5">
        <LogOutIcon className="sm:hidden" aria-hidden />
        <span className="sr-only sm:not-sr-only">Sign out</span>
      </Button>
    </form>
  );
}
