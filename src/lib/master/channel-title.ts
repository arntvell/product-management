// The product title Shopify and Sitoo show, which is not always Colorway.name.
//
// Cin7 and Threadflow colourways carry the whole product name ("Rose Merino
// Wine", "Utsjö Black"), and that is what every live title was built from. A
// colourway made in Origio — the wizard or an import, both through finalize —
// is named by its colour alone ("Chocolate"), because Loom nests it as
// style -> colour -> size and reads the name as the colour. Sent as-is, the shop
// and the till get a product called "Chocolate", or three called "Black".
//
// So Origio's own colourways get "Style Colour" on the channels that list
// products flat, and Loom keeps the bare colour. The prefix is skipped when the
// name already starts with the style, so someone who typed the full name into
// the wizard does not get "Rose Rose Chocolate".

export function channelProductTitle(cw: {
  source: string;
  name: string;
  style: { styleName: string } | null;
}): string {
  const name = cw.name.trim();
  const style = cw.style?.styleName.trim();
  if (cw.source !== "MANUAL" || !style) return name;
  if (name.toLowerCase().startsWith(style.toLowerCase())) return name;
  return `${style} ${name}`;
}
