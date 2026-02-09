"use client";

import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface DetailsEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function DetailsEditor({ value, onChange }: DetailsEditorProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">Details</Label>
      <p className="text-xs text-muted-foreground">
        Enter each detail on a new line (bullet points)
      </p>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        placeholder={"• Detail 1\n• Detail 2\n• Detail 3"}
        className="text-sm font-mono"
      />
    </div>
  );
}
