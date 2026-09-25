// The product title Shopify and Sitoo show, which is not always Colorway.name.
//
// Loom nests style -> colour -> size and reads Colorway.name as the colour, so
// a colourway named "Black" under style "Buzz" is right for Loom and wrong for
// the channels that list products flat: the shop and the till need "Buzz Black".
// Colourways made in Origio (wizard, import) are always named that way, and so
// are Cin7 and Threadflow rows once re-nested under their style.
//
// Legacy rows that already carry the whole name ("Boston Oiled Leather Habana"
// under "Boston Oiled Leather") start with the style and pass through unchanged,
// as does a wizard name typed in full — no "Rose Rose Chocolate".
//
// Checked against every live Shopify product on 2026-09-23: of 243 non-Origio
// colourways whose name does not start with the style, 230 are already titled
// "Style Colour" live — sending the bare name would have retitled them — and 2
// (Threadflow DRAFTs under "APT") are live as the bare name.

export function channelProductTitle(cw: {
  name: string;
  style: { styleName: string } | null;
}): string {
  const name = cw.name.trim();
  const style = cw.style?.styleName.trim();
  if (!style) return name;
  if (name.toLowerCase().startsWith(style.toLowerCase())) return name;
  return `${style} ${name}`;
}
