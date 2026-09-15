import type { DraftPayloadV1 } from "@/lib/master/draft-payload";
import type { SizeSystemView } from "@/lib/master/size-systems";

export interface WizardOptions {
  brands: { id: string; name: string; isLivid: boolean; skuToken: string | null }[];
  seasons: { id: string; code: string }[];
  sizeSystems: SizeSystemView[];
  manufacturers: { id: string; name: string }[];
}

export interface StepProps {
  payload: DraftPayloadV1;
  update: (next: DraftPayloadV1 | ((p: DraftPayloadV1) => DraftPayloadV1)) => void;
  options: WizardOptions;
}

/** Short random key, stable for the life of a draft row. */
export function newKey(): string {
  return Math.random().toString(36).slice(2, 10);
}
