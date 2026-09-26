import { FileSpreadsheet } from "lucide-react";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";

// Placeholder from the app shell (U4); the feature unit replaces this page.
export default function ImportPage() {
  return (
    <>
      <PageHeader
        title="Import"
        subtitle="Bring in a CSV from CellarTracker, Vivino, or a spreadsheet."
      />
      <EmptyState
        icon={<FileSpreadsheet />}
        title="Import is on its way"
        description="This screen will preview your file before anything is saved."
      />
    </>
  );
}
