import { ClinicNav } from "@/components/clinic/clinic-nav";
import { Toaster } from "@/components/ui/sonner";
import { clinicRole } from "@/lib/clinic/role";

export default async function ClinicLayout({ children }: LayoutProps<"/">) {
  const role = await clinicRole();
  return (
    <>
      <ClinicNav role={role} />
      {children}
      <Toaster position="bottom-right" />
    </>
  );
}
