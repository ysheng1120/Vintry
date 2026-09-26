import { House } from "lucide-react";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";

// Placeholder from the app shell (U4); the feature unit replaces this page.
export default function HomePage() {
  return (
    <>
      <PageHeader title="Home" subtitle="What is ready to drink, and what is coming up." />
      <EmptyState
        icon={<House />}
        title="Nothing to show yet"
        description="Wines you add will appear here, grouped by when to drink them."
      />
    </>
  );
}
