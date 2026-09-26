import { Skeleton } from "@/components/ui/skeleton";

export default function PatientsLoading() {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8" aria-busy="true" aria-label="Loading patients">
      <Skeleton className="h-8 w-40" />
      <div className="space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </main>
  );
}
