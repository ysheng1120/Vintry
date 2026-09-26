import { Wine } from "lucide-react";
import { Outlet } from "react-router";

export default function App() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border bg-surface px-4 py-3">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-primary">
          <Wine aria-hidden="true" className="size-6" />
          Vintry
        </h1>
      </header>
      <main className="flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
