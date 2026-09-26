import { Wine } from "lucide-react";
import { useParams } from "react-router";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";

// Placeholder from the app shell (U4); the feature unit replaces this page.
export default function WineDetailPage() {
  const { id } = useParams();
  return (
    <>
      <PageHeader title="Wine details" back={{ to: "/cellar", label: "Cellar" }} />
      <EmptyState
        icon={<Wine />}
        title="Details are on their way"
        description={`This screen will show bottles, notes, and the drinking window for wine ${id ?? ""}.`}
      />
    </>
  );
}
