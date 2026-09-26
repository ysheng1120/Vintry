import { Wine } from "lucide-react";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";

// Placeholder from the app shell (U4); the feature unit replaces this page.
export default function CellarPage() {
  return (
    <>
      <PageHeader title="Cellar" subtitle="Every bottle you own, in one place." />
      <EmptyState
        icon={<Wine />}
        title="Your cellar is empty"
        description="Add a wine to start your cellar."
      />
    </>
  );
}
