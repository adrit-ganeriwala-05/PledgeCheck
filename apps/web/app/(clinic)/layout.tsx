import { ClinicNav } from "@/components/clinic/clinic-nav";

export default function ClinicLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <ClinicNav />
      {children}
    </>
  );
}
