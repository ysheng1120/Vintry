import { PageHeader } from "../../components/ui/PageHeader";
import { SkeletonText } from "../../components/ui/Skeleton";
import { Tabs } from "../../components/ui/Tabs";
import { bottles } from "../../domain/labels";
import { useHistory, useRecentlyDeleted } from "../../domain/selectors";
import { formatDate } from "../../lib/format";
import { useConsumptionLog } from "./consumptionLog";
import { DeletedRow } from "./DeletedRow";
import { HistoryRow } from "./HistoryRow";

function AllChanges() {
  const history = useHistory();
  if (history === undefined) return <SkeletonText lines={5} />;
  if (history.length === 0) {
    return (
      <p className="text-ink-muted">No changes yet. Adds, drinks, moves and edits appear here.</p>
    );
  }
  return (
    <ul>
      {history.map((batch) => (
        <HistoryRow key={batch.id} batch={batch} />
      ))}
    </ul>
  );
}

function ConsumptionLog() {
  const rows = useConsumptionLog();
  if (rows === undefined) return <SkeletonText lines={5} />;
  if (rows.length === 0) {
    return <p className="text-ink-muted">No drinks recorded yet.</p>;
  }
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-border text-ink-muted">
          <th scope="col" className="py-2 pr-4 font-medium">
            Date
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            Wine
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            Quantity
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            Rating
          </th>
          <th scope="col" className="py-2 font-medium">
            Note
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-border last:border-0">
            <td className="py-2 pr-4 whitespace-nowrap">{formatDate(row.date)}</td>
            <td className="py-2 pr-4">{row.wineLabel}</td>
            <td className="py-2 pr-4 whitespace-nowrap">{bottles(row.quantity)}</td>
            <td className="py-2 pr-4">{row.rating !== null ? `${row.rating}/100` : "—"}</td>
            <td className="py-2">{row.note ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RecentlyDeleted() {
  const deleted = useRecentlyDeleted();
  if (deleted === undefined) return <SkeletonText lines={5} />;
  if (deleted.length === 0) {
    return <p className="text-ink-muted">Nothing recently deleted.</p>;
  }
  return (
    <ul>
      {deleted.map((item) => (
        <DeletedRow key={item.wine.id} item={item} />
      ))}
    </ul>
  );
}

export default function HistoryPage() {
  return (
    <>
      <PageHeader title="History" subtitle="Every change to your cellar, with undo." />
      <Tabs
        label="History"
        items={[
          { id: "all", label: "All changes", content: <AllChanges /> },
          { id: "consumption", label: "Consumption log", content: <ConsumptionLog /> },
          { id: "deleted", label: "Recently deleted", content: <RecentlyDeleted /> },
        ]}
      />
    </>
  );
}
