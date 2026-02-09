"use client";

import { cn, parseGidList } from "@/lib/utils";
import type { RenderType } from "@/lib/columns";
import type { ShopifyPage, ShopifyCollection, Model } from "@/types";

interface ReferenceCellProps {
  value: string;
  renderType: RenderType;
  isDirty: boolean;
  disabled?: boolean;
  onClick: () => void;
  pages?: ShopifyPage[];
  collections?: ShopifyCollection[];
  models?: Model[];
}

function resolveRefName(
  value: string,
  renderType: RenderType,
  pages?: ShopifyPage[],
  collections?: ShopifyCollection[],
  models?: Model[]
): string | null {
  if (!value) return null;

  switch (renderType) {
    case "ref_page": {
      const page = pages?.find((p) => p.id === value);
      return page?.title || null;
    }
    case "ref_collection": {
      const col = collections?.find((c) => c.id === value);
      return col?.title || null;
    }
    case "ref_metaobject": {
      // model_info stores formatted text directly, not a GID
      return value || null;
    }
    case "ref_product": {
      const ids = parseGidList(value);
      if (ids.length === 0) return null;
      return `${ids.length} linked`;
    }
    default:
      return null;
  }
}

export function ReferenceCell({
  value,
  renderType,
  isDirty,
  disabled,
  onClick,
  pages,
  collections,
  models,
}: ReferenceCellProps) {
  if (disabled) {
    return (
      <div className="px-2 py-1.5 min-h-[32px] text-sm text-muted-foreground">
        N/A
      </div>
    );
  }

  const resolved = resolveRefName(value, renderType, pages, collections, models);

  return (
    <div
      className={cn(
        "px-2 py-1.5 min-h-[32px] cursor-pointer text-sm",
        isDirty && "bg-yellow-50"
      )}
      onClick={onClick}
    >
      {resolved ? (
        <div className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
          <span className="text-xs truncate">{resolved}</span>
        </div>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </div>
  );
}
