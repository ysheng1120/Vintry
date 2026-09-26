import { History } from "lucide-react";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";

// Placeholder from the app shell (U4); the feature unit replaces this page.
export default function HistoryPage() {
  return (
    <>
      <PageHeader title="History" subtitle="Every change to your cellar, with undo." />
      <EmptyState
        icon={<History />}
        title="No changes yet"
        description="Adds, drinks, moves, and edits will be listed here."
      />
    </>
  );
}
