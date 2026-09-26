import { PenLine } from "lucide-react";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";

// Temporary page used until the owning unit replaces its stub.
export function Placeholder({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} back={{ to: "/add", label: "Add wine" }} />
      <EmptyState icon={<PenLine />} title="On its way" description={description} />
    </>
  );
}
