import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import { MessageCirclePlus } from "lucide-react";
import { Link } from "react-router";
import { listThreads } from "../../ai/sommelier/thread";
import { buttonClasses } from "../../components/ui/buttonStyles";
import { formatDate } from "../../lib/format";

/** Earlier conversations, newest first, with a New chat link. */
export function ThreadList({ currentThreadId }: { currentThreadId: string | null }) {
  const threads = useLiveQuery(listThreads, []);
  return (
    <nav aria-label="Conversations" className="flex flex-col gap-3">
      <Link
        to="/sommelier"
        className={buttonClasses({ variant: "secondary", className: "w-full" })}
      >
        <MessageCirclePlus aria-hidden="true" className="size-4" />
        New chat
      </Link>
      {threads && threads.length > 0 && (
        <ul className="flex flex-col gap-1">
          {threads.map((thread) => {
            const current = thread.id === currentThreadId;
            return (
              <li key={thread.id}>
                <Link
                  to={`/sommelier/${encodeURIComponent(thread.id)}`}
                  aria-current={current ? "page" : undefined}
                  className={clsx(
                    "flex min-h-10 flex-col justify-center rounded-xl px-3 py-2 text-sm hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-ring",
                    current ? "bg-surface-muted font-medium text-ink" : "text-ink-muted",
                  )}
                >
                  <span className="truncate">{thread.title || "New conversation"}</span>
                  <span className="text-xs text-ink-subtle">{formatDate(thread.updatedAt)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
