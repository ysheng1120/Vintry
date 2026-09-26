import { Heart } from "lucide-react";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";

// Placeholder from the app shell (U4); the feature unit replaces this page.
export default function WishlistPage() {
  return (
    <>
      <PageHeader title="Wishlist" subtitle="Wines you would like to buy." />
      <EmptyState
        icon={<Heart />}
        title="Your wishlist is empty"
        description="Save wines you want to find later."
      />
    </>
  );
}
