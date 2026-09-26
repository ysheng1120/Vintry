import { Gift } from "lucide-react";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";

// Placeholder from the app shell (U4); the feature unit replaces this page.
export default function WhatsNewPage() {
  return (
    <>
      <PageHeader title="What's new" subtitle="Recent changes to Vintry." />
      <EmptyState
        icon={<Gift />}
        title="No release notes yet"
        description="Changes are listed here after each update."
      />
    </>
  );
}
