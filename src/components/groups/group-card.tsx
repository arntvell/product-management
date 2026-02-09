"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { Product, ProductGroup } from "@/types";

interface GroupCardProps {
  group: ProductGroup;
  onAutoLink: (group: ProductGroup, memberIds: string[]) => void;
  isLinking: boolean;
}

export function GroupCard({ group, onAutoLink, isLinking }: GroupCardProps) {
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [showReview, setShowReview] = useState(false);

  const activeMembers = group.members.filter((m) => !excludedIds.has(m.id));

  const toggleExclude = (id: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const statusColor = {
    linked: "bg-green-100 text-green-800",
    partially_linked: "bg-yellow-100 text-yellow-800",
    not_linked: "bg-gray-100 text-gray-800",
  };

  const statusLabel = {
    linked: "Linked",
    partially_linked: "Partially Linked",
    not_linked: "Not Linked",
  };

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-medium">{group.baseName}</h3>
          <p className="text-xs text-muted-foreground">
            {group.vendor} &middot; {group.productType} &middot;{" "}
            {group.members.length} products
          </p>
        </div>
        <Badge className={cn("text-xs", statusColor[group.linkStatus])}>
          {statusLabel[group.linkStatus]}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        {group.members.map((member) => (
          <ProductChip
            key={member.id}
            product={member}
            excluded={excludedIds.has(member.id)}
            showCheckbox={showReview}
            onToggle={() => toggleExclude(member.id)}
          />
        ))}
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() =>
            onAutoLink(
              group,
              activeMembers.map((m) => m.id)
            )
          }
          disabled={isLinking || activeMembers.length < 2}
        >
          {isLinking
            ? "Linking..."
            : group.linkStatus === "linked"
              ? "Re-link All"
              : "Auto-link"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowReview(!showReview)}
        >
          {showReview ? "Done Reviewing" : "Review Members"}
        </Button>
      </div>
    </div>
  );
}

function ProductChip({
  product,
  excluded,
  showCheckbox,
  onToggle,
}: {
  product: Product;
  excluded: boolean;
  showCheckbox: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded border text-sm",
        excluded && "opacity-40 line-through"
      )}
    >
      {showCheckbox && (
        <Checkbox checked={!excluded} onCheckedChange={onToggle} />
      )}
      {product.featuredImage && (
        <img
          src={product.featuredImage}
          alt=""
          className="w-6 h-6 rounded object-cover"
        />
      )}
      <span className="max-w-[180px] truncate">{product.title}</span>
    </div>
  );
}
