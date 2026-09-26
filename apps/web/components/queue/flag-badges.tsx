import { Badge } from "@/components/ui/badge";

import { flagLabel } from "./flags";

export function FlagBadges({ flags }: { flags: string[] }) {
  if (flags.length === 0) return null;
  return (
    <ul aria-label="Flags" className="flex flex-wrap gap-1.5">
      {flags.map((flag) => {
        const { label, known } = flagLabel(flag);
        return (
          <li key={flag}>
            <Badge
              variant={known ? "secondary" : "outline"}
              title={known ? flag : "Unrecognized flag, shown as received"}
              className={known ? undefined : "font-mono"}
            >
              {label}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
