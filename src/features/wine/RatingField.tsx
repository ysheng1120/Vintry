import { StarRating } from "../../components/ui/StarRating";

/** The "Rating" caption and star picker used by the drink and note sheets. */
export function RatingField({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink" aria-hidden="true">
        Rating
      </span>
      <StarRating value={value} onChange={onChange} label="Rating" />
    </div>
  );
}
