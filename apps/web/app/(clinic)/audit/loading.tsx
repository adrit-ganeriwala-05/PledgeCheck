import { Skeleton } from "@/components/ui/skeleton";

export default function AuditLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8" aria-busy="true" aria-label="Loading audit log">
      <Skeleton className="h-8 w-40" />
      <div className="flex gap-3">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </main>
  );
}
