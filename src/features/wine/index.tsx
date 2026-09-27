import {
  ArrowRightLeft,
  GlassWater,
  Merge,
  MessageCircle,
  NotebookPen,
  Pencil,
  ShoppingCart,
  Trash2,
  Wine as WineIcon,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { buttonClasses } from "../../components/ui/buttonStyles";
import { Card } from "../../components/ui/Card";
import { ColorDot } from "../../components/ui/ColorDot";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { Skeleton, SkeletonText } from "../../components/ui/Skeleton";
import { WindowBar } from "../../components/ui/WindowBar";
import { currentYear } from "../../domain/clock";
import { addWishlistItem, deleteWine, type CommandResult } from "../../domain/commands";
import { bottleSizeLabel, bottles, wineLabel } from "../../domain/labels";
import { normalizeName } from "../../domain/match";
import { formatMoney, wineValue } from "../../domain/money";
import { useWineDetail, useWishlist, type WineDetail } from "../../domain/selectors";
import { COLOUR_LABELS, type Wine, type WishlistItem } from "../../domain/types";
import { formatDate } from "../../lib/format";
import { useCommandFeedback } from "../../app/commandFeedback";
import { StatusBadge, WindowSourceBadge } from "../cellar/StatusBadge";
import AboutWineCard from "./AboutWineCard";
import CriticsCard from "./CriticsCard";
import { DrinkSheet } from "./DrinkSheet";
import { EditWineSheet } from "./EditWineSheet";
import EstimateWindowButton from "./EstimateWindowButton";
import { LotsCard } from "./LotsCard";
import { MergeSheet } from "./MergeSheet";
import { MoveSheet } from "./MoveSheet";
import { NoteSheet } from "./NoteSheet";
import PricesCard from "./PricesCard";
import { WindowSheet } from "./WindowSheet";
import { TastingHistory, WineActivity } from "./WineHistory";

type OpenSheet =
  | { kind: "drink" | "move"; lotId?: string }
  | { kind: "edit" | "window" | "note" | "merge" | "delete" }
  | null;

/** One wine: identity, drinking window, bottles by location, actions, and history (R1–R4). */
export default function WineDetailPage() {
  const { id } = useParams();
  const detail = useWineDetail(id);
  const wishlist = useWishlist();
  const navigate = useNavigate();
  const { done, failed } = useCommandFeedback();
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [deleting, setDeleting] = useState(false);
  const [addingToWishlist, setAddingToWishlist] = useState(false);

  if (detail === undefined) {
    return (
      <>
        <PageHeader title="Wine details" back={{ to: "/cellar", label: "Cellar" }} />
        <div aria-busy="true" className="flex flex-col gap-4">
          <Skeleton className="h-28 rounded-2xl" />
          <SkeletonText lines={4} />
        </div>
      </>
    );
  }

  if (detail === null) {
    return (
      <>
        <PageHeader title="Wine details" back={{ to: "/cellar", label: "Cellar" }} />
        <EmptyState
          icon={<WineIcon />}
          title="This wine isn't in your cellar"
          description="It may have been deleted. Deleted wines stay in History for 30 days, where you can restore them."
          action={
            <>
              <Link to="/cellar" className={buttonClasses({ variant: "primary" })}>
                Back to the cellar
              </Link>
              <Link to="/history" className={buttonClasses({ variant: "secondary" })}>
                Open History
              </Link>
            </>
          }
        />
      </>
    );
  }

  const { wine } = detail;
  const close = () => setSheet(null);
  const finish = (result: CommandResult | null) => {
    setSheet(null);
    if (result) done(result);
  };

  const remove = async () => {
    setDeleting(true);
    try {
      const result = await deleteWine({ wineId: wine.id });
      await navigate("/cellar");
      done(result);
    } catch (error) {
      failed(error, "Couldn't delete this wine");
      setDeleting(false);
      setSheet(null);
    }
  };

  const hasBottles = detail.lots.length > 0;
  const wishlistMatch = findWishlistMatch(wishlist, wine);

  const buyAgain = async () => {
    // A second click before the wishlist updates must not add the wine twice.
    if (addingToWishlist) return;
    setAddingToWishlist(true);
    try {
      const result = await addWishlistItem({
        producer: wine.producer,
        name: wine.name,
        vintage: wine.vintage,
        colour: wine.colour,
        country: wine.country,
        region: wine.region,
        notes: "Buy again",
      });
      done(result);
    } catch (error) {
      failed(error, "Couldn't add this to your wishlist");
    } finally {
      setAddingToWishlist(false);
    }
  };

  return (
    <>
      <PageHeader
        back={{ to: "/cellar", label: "Cellar" }}
        eyebrow={[wine.region, wine.country].filter(Boolean).join(", ") || undefined}
        title={wineLabel(wine)}
        subtitle={<WineFacts detail={detail} />}
        actions={
          wine.thumbnail ? (
            <img
              src={wine.thumbnail}
              alt={`Label of ${wineLabel(wine)}`}
              className="size-24 rounded-2xl border border-border object-cover shadow-card"
            />
          ) : undefined
        }
      />
      <YourValue wine={wine} />

      <div className="mb-6 flex flex-wrap gap-2" role="toolbar" aria-label="Wine actions">
        <Button
          icon={<GlassWater aria-hidden="true" className="size-4" />}
          disabled={!hasBottles}
          onClick={() => setSheet({ kind: "drink" })}
        >
          Drink
        </Button>
        <Button
          variant="secondary"
          icon={<ArrowRightLeft aria-hidden="true" className="size-4" />}
          disabled={!hasBottles}
          onClick={() => setSheet({ kind: "move" })}
        >
          Move
        </Button>
        <Button
          variant="secondary"
          icon={<Pencil aria-hidden="true" className="size-4" />}
          onClick={() => setSheet({ kind: "edit" })}
        >
          Edit
        </Button>
        <Button
          variant="secondary"
          icon={<NotebookPen aria-hidden="true" className="size-4" />}
          onClick={() => setSheet({ kind: "note" })}
        >
          Add note
        </Button>
        <Link
          to={`/sommelier?wine=${encodeURIComponent(wine.id)}`}
          className={buttonClasses({ variant: "secondary" })}
        >
          <MessageCircle aria-hidden="true" className="size-4" />
          Ask sommelier
        </Link>
        {!wine.isSample &&
          (wishlistMatch ? (
            <Link to="/wishlist" className={buttonClasses({ variant: "ghost" })}>
              <ShoppingCart aria-hidden="true" className="size-4" />
              On your wishlist
            </Link>
          ) : (
            <Button
              variant="ghost"
              icon={<ShoppingCart aria-hidden="true" className="size-4" />}
              disabled={addingToWishlist}
              onClick={() => void buyAgain()}
            >
              Buy again
            </Button>
          ))}
        <Button
          variant="ghost"
          icon={<Merge aria-hidden="true" className="size-4" />}
          onClick={() => setSheet({ kind: "merge" })}
        >
          Merge<span className="sr-only"> with another wine</span>
        </Button>
        <Button
          variant="ghost"
          className="text-danger hover:text-danger"
          icon={<Trash2 aria-hidden="true" className="size-4" />}
          onClick={() => setSheet({ kind: "delete" })}
        >
          Delete
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <LotsCard
            detail={detail}
            onDrink={(lotId) => setSheet({ kind: "drink", lotId })}
            onMove={(lotId) => setSheet({ kind: "move", lotId })}
          />
          <TastingHistory detail={detail} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Card padding="lg">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Drinking window</h2>
              <StatusBadge status={detail.status} />
            </div>
            <WindowBar from={wine.windowFrom} to={wine.windowTo} current={currentYear()} />
            {(wine.windowSource || wine.windowNote) && (
              <div className="mt-3 flex flex-col items-start gap-2">
                {wine.windowSource && <WindowSourceBadge source={wine.windowSource} />}
                {wine.windowNote && <p className="text-sm text-ink-muted">{wine.windowNote}</p>}
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setSheet({ kind: "window" })}>
                {wine.windowFrom !== null || wine.windowTo !== null ? "Edit window" : "Set window"}
              </Button>
              <EstimateWindowButton wine={wine} />
            </div>
          </Card>
          <AboutWineCard wine={wine} />
          <CriticsCard wine={wine} />
          <PricesCard wine={wine} />
          {wine.notes && (
            <Card padding="lg">
              <h2 className="mb-2 text-lg font-semibold">Notes</h2>
              <p className="whitespace-pre-line text-ink-muted">{wine.notes}</p>
            </Card>
          )}
          <WineActivity detail={detail} />
        </div>
      </div>

      {sheet?.kind === "drink" && (
        <DrinkSheet
          wine={wine}
          lots={detail.lots}
          initialLotId={sheet.lotId}
          onClose={close}
          onDone={finish}
        />
      )}
      {sheet?.kind === "move" && (
        <MoveSheet
          wine={wine}
          lots={detail.lots}
          initialLotId={sheet.lotId}
          onClose={close}
          onDone={finish}
        />
      )}
      {sheet?.kind === "edit" && <EditWineSheet wine={wine} onClose={close} onDone={finish} />}
      {sheet?.kind === "window" && <WindowSheet wine={wine} onClose={close} onDone={finish} />}
      {sheet?.kind === "note" && <NoteSheet wine={wine} onClose={close} onDone={finish} />}
      {sheet?.kind === "merge" && <MergeSheet wine={wine} onClose={close} />}
      <ConfirmDialog
        open={sheet?.kind === "delete"}
        title="Delete this wine?"
        description={`${wineLabel(wine)} and its ${bottles(detail.bottles)} leave your cellar. You can undo right away, or restore it from History for 30 days.`}
        confirmLabel="Delete wine"
        tone="danger"
        busy={deleting}
        onConfirm={() => void remove()}
        onCancel={close}
      />
    </>
  );
}

/** The wishlist's own item for this wine (producer + name + vintage), ignoring sample rows. */
function findWishlistMatch(
  items: WishlistItem[] | undefined,
  wine: Pick<Wine, "producer" | "name" | "vintage">,
): WishlistItem | undefined {
  const key = [normalizeName(wine.producer), normalizeName(wine.name), wine.vintage ?? "nv"].join(
    "|",
  );
  return items?.find(
    (item) =>
      !item.isSample &&
      [normalizeName(item.producer), normalizeName(item.name), item.vintage ?? "nv"].join("|") ===
        key,
  );
}

function WineFacts({ detail }: { detail: WineDetail }) {
  const { wine } = detail;
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="inline-flex items-center gap-2">
        <ColorDot color={wine.colour} decorative />
        {COLOUR_LABELS[wine.colour]}
      </span>
      {wine.appellation && <span>{wine.appellation}</span>}
      {wine.grapes.length > 0 && <span>{wine.grapes.join(", ")}</span>}
      <span>{bottleSizeLabel(wine.bottleSize)}</span>
      <span className="font-semibold text-ink">{bottles(detail.bottles)}</span>
      {wine.isSample && <Badge>Sample</Badge>}
    </span>
  );
}

/** The collector's own value per bottle, when they entered one. */
function YourValue({ wine }: { wine: Wine }) {
  const value = wineValue(wine);
  if (!value) return null;
  return (
    <p className="-mt-4 mb-6 text-sm text-ink-muted">
      Your value:{" "}
      <span className="font-semibold text-ink tabular-nums">
        {formatMoney(value.amount, value.currency)}
      </span>{" "}
      a bottle{value.updatedAt ? `, updated ${formatDate(value.updatedAt)}` : ""}
    </p>
  );
}
