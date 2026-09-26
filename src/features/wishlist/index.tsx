import { Heart, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { SkeletonText } from "../../components/ui/Skeleton";
import { useToast } from "../../components/ui/useToast";
import { CommandError } from "../../domain/commands/core";
import { removeWishlistItem } from "../../domain/commands/wishlist";
import { wineLabel } from "../../domain/labels";
import { undoBatch } from "../../domain/undo";
import { useWishlist } from "../../domain/selectors";
import type { WishlistItem } from "../../domain/types";
import { WishlistCard } from "./WishlistCard";
import { WishlistForm } from "./WishlistForm";

export default function WishlistPage() {
  const items = useWishlist();
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WishlistItem | null>(null);
  const [removing, setRemoving] = useState<WishlistItem | null>(null);
  const [busy, setBusy] = useState(false);

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(item: WishlistItem) {
    setEditing(item);
    setFormOpen(true);
  }

  async function confirmRemove() {
    if (!removing) return;
    setBusy(true);
    try {
      const result = await removeWishlistItem({ itemId: removing.id });
      toast({
        title: result.summary,
        tone: "success",
        action: result.batchId
          ? { label: "Undo", onClick: () => void undoBatch(result.batchId!) }
          : undefined,
      });
      setRemoving(null);
    } catch (err) {
      toast({
        title: err instanceof CommandError ? err.message : "Could not remove that item.",
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Wishlist"
        subtitle="Wines you would like to buy."
        actions={
          <Button icon={<Plus aria-hidden="true" />} onClick={openAdd}>
            Add to wishlist
          </Button>
        }
      />
      {items === undefined ? (
        <SkeletonText lines={4} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Heart />}
          title="Your wishlist is empty"
          description="Save a wine you want to find later."
          action={
            <Button icon={<Plus aria-hidden="true" />} onClick={openAdd}>
              Add to wishlist
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={item.id}>
              <WishlistCard
                item={item}
                onEdit={() => openEdit(item)}
                onRemove={() => setRemoving(item)}
              />
            </li>
          ))}
        </ul>
      )}
      <WishlistForm open={formOpen} item={editing} onClose={() => setFormOpen(false)} />
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing ? wineLabel(removing) : "this item"}?`}
        description="It comes off your wishlist. This can be undone from a toast right after."
        confirmLabel="Remove"
        tone="danger"
        busy={busy}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      />
    </>
  );
}
