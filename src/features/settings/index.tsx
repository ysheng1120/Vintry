import { Settings } from "lucide-react";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";

// Placeholder from the app shell (U4); the feature unit replaces this page.
export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" subtitle="AI key, theme, and currency." />
      <EmptyState
        icon={<Settings />}
        title="Settings are on their way"
        description="This screen will let you add an AI key and choose a theme."
      />
    </>
  );
}
