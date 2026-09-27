import { useLiveQuery } from "dexie-react-hooks";
import { Info } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { Card } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { SkeletonText } from "../../components/ui/Skeleton";
import { db } from "../../db/db";
import { convertWishlistItem, type CommandResult } from "../../domain/commands";
import type { WishlistItem } from "../../domain/types";
import { useCommandFeedback } from "../../app/commandFeedback";
import { DraftCard } from "./DraftCard";
import type { BottleDraft, DraftCardProps } from "./draft";

/** One empty wine with one bottle; the card fills in the default location and currency. */
const EMPTY_DRAFT: BottleDraft = { lots: [{ quantity: 1 }] };

/** A draft prefilled from a wishlist item. An unknown vintage stays blank (not NV). */
function draftFromWishlist(item: WishlistItem): BottleDraft {
  return {
    producer: item.producer,
    name: item.name,
    vintage: item.vintage ?? undefined,
    colour: item.colour,
    country: item.country,
    region: item.region,
    wineNotes: item.notes,
    lots: [{ quantity: 1, currency: item.currency }],
  };
}

/**
 * Add by hand (R2): works offline and without an AI key. With `?fromWishlist=<id>` it turns a
 * wishlist item into bottles (R8) and takes it off the wishlist in the same change.
 */
export default function ManualPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const wishlistId = params.get("fromWishlist");
  const { done } = useCommandFeedback();
  // undefined while loading; null when there is no item (or no param).
  const item = useLiveQuery(
    async () => (wishlistId ? ((await db.wishlist.get(wishlistId)) ?? null) : null),
    [wishlistId],
  );

  const onSaved = (result: CommandResult) => {
    done(result, {
      onUndone: () => void navigate(item ? "/wishlist" : "/add/manual"),
    });
    const [wineId] = result.touched.wineIds;
    void navigate(wineId ? `/wine/${wineId}` : "/cellar");
  };

  let card;
  if (item === undefined) {
    card = (
      <Card aria-busy="true">
        <SkeletonText lines={6} />
      </Card>
    );
  } else {
    const fromWishlist = item !== null;
    const save: DraftCardProps["save"] = item
      ? ([draft]) => {
          if (!draft) throw new Error("Nothing to add.");
          return convertWishlistItem({ itemId: item.id, draft }, { source: "user" });
        }
      : undefined;
    card = (
      <DraftCard
        // Keyed so the form starts fresh when the item loads or the param changes.
        key={item?.id ?? "empty"}
        drafts={[item ? draftFromWishlist(item) : EMPTY_DRAFT]}
        source="user"
        save={save}
        onSaved={onSaved}
        onCancel={() => void navigate(fromWishlist ? "/wishlist" : "/add")}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Add by hand"
        subtitle={
          item
            ? "Check the details from your wishlist, then add the bottles you bought."
            : "Only the producer and vintage are needed. Everything else can wait."
        }
        back={item ? { to: "/wishlist", label: "Wishlist" } : { to: "/add", label: "Add wine" }}
      />
      {wishlistId && item === null && (
        <p
          role="status"
          className="mb-4 flex items-center gap-2 rounded-xl bg-info-soft px-4 py-3 text-sm text-ink"
        >
          <Info aria-hidden="true" className="size-4 shrink-0 text-info" />
          That wishlist item is no longer there, so this is a blank form.
        </p>
      )}
      {card}
    </>
  );
}
