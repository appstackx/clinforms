import type { Metadata } from "next";
import { TemplatesScreen } from "@/modules/medreport/ui/screens/templates/templates-screen";

export const metadata: Metadata = { title: "Built-in templates" };

export default function TenantTemplatesPage() {
  return <TemplatesScreen />;
}
