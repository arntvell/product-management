import { NextResponse } from "next/server";
import { DraftError } from "./drafts";

/** A draft route's error as JSON: a DraftError carries its own status. */
export function draftFailure(err: unknown) {
  if (err instanceof DraftError) return NextResponse.json({ error: err.message }, { status: err.status });
  return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
}
