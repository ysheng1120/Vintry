import { MapPin } from "lucide-react";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";

// Placeholder from the app shell (U4); the feature unit replaces this page.
export default function LocationsPage() {
  return (
    <>
      <PageHeader title="Locations" subtitle="Racks, fridges, and bins where your bottles live." />
      <EmptyState
        icon={<MapPin />}
        title="No locations yet"
        description="Add places like “Kitchen rack” or “EuroCave A”."
      />
    </>
  );
}
