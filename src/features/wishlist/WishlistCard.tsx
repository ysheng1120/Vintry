import { Pencil, ShoppingCart, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { Card } from "../../components/ui/Card";
import { ColorDot } from "../../components/ui/ColorDot";
import { IconButton } from "../../components/ui/IconButton";
import { buttonClasses } from "../../components/ui/buttonStyles";
import { wineLabel } from "../../domain/labels";
import { formatMoney } from "../../domain/money";
import type { WishlistItem } from "../../domain/types";

export interface WishlistCardProps {
  item: WishlistItem;
  onEdit: () => void;
  onRemove: () => void;
}

export function WishlistCard({ item, onEdit, onRemove }: WishlistCardProps) {
  const place = [item.region, item.country].filter(Boolean).join(", ");
  return (
    <Card className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-ink-subtle">
            {item.colour && <ColorDot color={item.colour} />}
            {place && <span className="truncate">{place}</span>}
          </div>
          <p className="mt-1 font-display font-semibold text-ink">{wineLabel(item)}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <IconButton label="Edit" icon={<Pencil />} onClick={onEdit} />
          <IconButton label="Remove" icon={<Trash2 />} onClick={onRemove} />
        </div>
      </div>
      {item.targetPrice != null && item.currency && (
        <p className="text-sm text-ink">
          Target {formatMoney(item.targetPrice, item.currency)} a bottle
        </p>
      )}
      {item.notes && <p className="text-sm text-ink-muted">{item.notes}</p>}
      <Link
        to={`/add/manual?fromWishlist=${item.id}`}
        className={buttonClasses({
          variant: "secondary",
          size: "sm",
          className: "mt-auto self-start",
        })}
      >
        <ShoppingCart aria-hidden="true" className="size-4" />
        Mark as bought
      </Link>
    </Card>
  );
}
