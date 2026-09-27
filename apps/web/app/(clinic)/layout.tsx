import { ClinicNav } from "@/components/clinic/clinic-nav";
import { Toaster } from "@/components/ui/sonner";

export default function ClinicLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <ClinicNav />
      {children}
      <Toaster position="bottom-right" />
    </>
  );
}
