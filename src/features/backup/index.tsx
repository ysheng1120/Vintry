import { ShieldCheck } from "lucide-react";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";

// Placeholder from the app shell (U4); the feature unit replaces this page.
export default function BackupPage() {
  return (
    <>
      <PageHeader title="Backup & restore" subtitle="Keep your records safe with a backup file." />
      <EmptyState
        icon={<ShieldCheck />}
        title="Backups are on their way"
        description="This screen will let you export and restore your cellar."
      />
    </>
  );
}
