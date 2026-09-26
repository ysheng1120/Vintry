import { ChartColumn } from "lucide-react";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";

// Placeholder from the app shell (U4); the feature unit replaces this page.
export default function StatsPage() {
  return (
    <>
      <PageHeader title="Stats" subtitle="Your cellar in numbers." />
      <EmptyState
        icon={<ChartColumn />}
        title="No stats yet"
        description="Charts appear once your cellar has some wines."
      />
    </>
  );
}
