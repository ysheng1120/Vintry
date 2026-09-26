import { CircleHelp } from "lucide-react";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";

// Placeholder from the app shell (U4); the feature unit replaces this page.
export default function HelpPage() {
  return (
    <>
      <PageHeader title="How to use Vintry" subtitle="A short guide to every screen." />
      <EmptyState
        icon={<CircleHelp />}
        title="Help is on its way"
        description="This page will explain how to add, drink, and find your wines."
      />
    </>
  );
}
