import clsx from "clsx";
import { useId } from "react";
import { setSelectedModel, useSelectedModelId } from "../../ai/client";
import { formatUsd, labelScanCostExample, MODELS } from "../../ai/models";

/** Model choice as radio cards, each with the cost of one label scan (R19, KTD3). */
export function ModelSettings() {
  const selected = useSelectedModelId();
  const baseId = useId();
  return (
    <fieldset>
      <legend className="text-sm font-medium text-ink">Model</legend>
      <p className="mt-1 text-sm text-ink-muted">
        Costs are estimates from Anthropic's prices, paid to Anthropic with your key.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {MODELS.map((model) => {
          const titleId = `${baseId}-${model.id}-title`;
          const detailId = `${baseId}-${model.id}-detail`;
          const cost = labelScanCostExample(model.id);
          const checked = model.id === selected;
          return (
            <label
              key={model.id}
              className={clsx(
                "flex cursor-pointer gap-3 rounded-2xl border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                checked
                  ? "border-primary bg-primary-soft"
                  : "border-border bg-surface hover:border-border-strong",
              )}
            >
              <input
                type="radio"
                name={`${baseId}-model`}
                value={model.id}
                checked={checked}
                onChange={() => void setSelectedModel(model.id)}
                aria-labelledby={titleId}
                aria-describedby={detailId}
                className="mt-1 size-4 shrink-0 accent-primary"
              />
              <span className="min-w-0">
                <span id={titleId} className="block font-medium text-ink">
                  {model.label}
                </span>
                <span id={detailId} className="mt-1 block text-sm text-ink-muted">
                  {model.description}{" "}
                  <span className="font-medium text-ink">
                    {cost === null ? "Price unknown." : `About ${formatUsd(cost)} per label scan.`}
                  </span>
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
