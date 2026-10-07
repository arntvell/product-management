"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Create an external brand, then land on its settings page — which is where the
 * defaults, channels and the Sitoo link are filled in.
 */
export function NewBrandDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [skuToken, setSkuToken] = useState("");
  const [similar, setSimilar] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function reset() {
    setName("");
    setSkuToken("");
    setSimilar([]);
  }

  async function create(confirmSimilar: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/catalog/brands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, skuToken: skuToken || null, confirmSimilar }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not create the brand");
      if (!json.ok) {
        setSimilar(json.similar);
        return;
      }
      toast.success(`Created ${json.name}`);
      setOpen(false);
      reset();
      router.push(`/catalog/brands/${json.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the brand");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">New brand</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New brand</DialogTitle>
          <DialogDescription>
            An external brand. Its defaults, channels and Sitoo link are set on the next
            page.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void create(false);
          }}
        >
          <div>
            <Label htmlFor="new-brand-name" className="text-fine">
              Name
            </Label>
            <Input
              id="new-brand-name"
              className="mt-1.5"
              value={name}
              autoFocus
              onChange={(e) => {
                setName(e.target.value);
                setSimilar([]);
              }}
              placeholder="As the brand writes it"
            />
          </div>
          <div>
            <Label htmlFor="new-brand-token" className="text-fine">
              SKU token (optional)
            </Label>
            <Input
              id="new-brand-token"
              className="mt-1.5 font-mono"
              value={skuToken}
              maxLength={8}
              onChange={(e) => setSkuToken(e.target.value.toUpperCase())}
              placeholder="Derived from the name if blank"
            />
            <p className="mt-1 text-fine text-muted-foreground">
              What the brand is called in a SKU, e.g. PB for Paraboot. A SKU is never
              rewritten, so set it before the first product if the brand already has one.
            </p>
          </div>

          {similar.length ? (
            <Notice
              title="Similar brands exist"
              action={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => create(true)}
                >
                  Create anyway
                </Button>
              }
            >
              {similar.join(", ")}. If it is one of these, use that brand instead.
            </Notice>
          ) : null}

          <DialogFooter>
            <Button type="submit" disabled={busy || !name.trim() || similar.length > 0}>
              {busy ? "Creating…" : "Create brand"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
