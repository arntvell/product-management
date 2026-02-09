"use client";

import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface TextEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}

export function TextEditor({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
}: TextEditorProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={multiline ? 6 : 2}
        placeholder={placeholder}
        className="text-sm"
      />
    </div>
  );
}
