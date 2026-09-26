import { Button } from "@/components/ui/button";

/** Plain form POST, so sign-out works without client JavaScript. */
export function SignOutButton() {
  return (
    <form action="/login/sign-out" method="post">
      <Button type="submit" variant="outline" size="sm">
        Sign out
      </Button>
    </form>
  );
}
