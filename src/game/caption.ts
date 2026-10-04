export const CAPTION_MIN = 3;
export const CAPTION_MAX = 100;
// Match native textarea maxLength (UTF-16 units), without splitting emoji clusters.
export function truncateCaption(value: string) {
  let result = "";
  for (const { segment } of new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  }).segment(value)) {
    if (result.length + segment.length > CAPTION_MAX) break;
    result += segment;
  }
  return result;
}
