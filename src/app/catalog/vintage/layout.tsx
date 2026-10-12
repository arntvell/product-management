import { EditGate } from "@/components/auth/edit-gate";

// Readable by every role; editable by Vintage, Product manager and Admin.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <EditGate permission="vintage">{children}</EditGate>;
}
