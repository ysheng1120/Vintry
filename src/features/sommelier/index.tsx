import { MessageCircle } from "lucide-react";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";

// Placeholders from the app shell (U4); the sommelier unit replaces these pages.
export default function SommelierPage() {
  return (
    <>
      <PageHeader
        title="Sommelier"
        subtitle="Ask about your own bottles: what to open tonight, what goes with lamb."
      />
      <EmptyState
        icon={<MessageCircle />}
        title="The sommelier is on its way"
        description="It will answer using only the wines in your cellar."
      />
    </>
  );
}

export function ThreadPage() {
  return (
    <>
      <PageHeader title="Conversation" back={{ to: "/sommelier", label: "Sommelier" }} />
      <EmptyState icon={<MessageCircle />} title="Nothing here yet" />
    </>
  );
}
