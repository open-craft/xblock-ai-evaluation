// Persist these keys, never computed colors. Both the learner background and
// Studio thumbnails resolve the same theme variables at render time.
export const BACKGROUND_OPTIONS = [
  {
    value: "default",
    label: { id: "shortanswer.background.default", defaultMessage: "Use course default" },
    color: "var(--pgn-shortanswer-container-bg-color, var(--pgn-wgu-color-lake-50, #EDF7FD))",
  },
  {
    value: "lake",
    label: { id: "shortanswer.background.lake", defaultMessage: "Lake 50" },
    color: "var(--pgn-wgu-color-lake-50, #EDF7FD)",
  },
  {
    value: "blue",
    label: { id: "shortanswer.background.blue", defaultMessage: "Blue 50" },
    color: "var(--pgn-wgu-color-blue-50, #E6F1FE)",
  },
  {
    value: "navy",
    label: { id: "shortanswer.background.navy", defaultMessage: "Navy 50" },
    color: "var(--pgn-wgu-color-navy-50, #E6EAEE)",
  },
  {
    value: "white",
    label: { id: "shortanswer.background.white", defaultMessage: "White" },
    color: "var(--pgn-color-white, #FFFFFF)",
  },
] as const;

export function getBackgroundOption(value?: string) {
  return BACKGROUND_OPTIONS.find((option) => option.value === value) || BACKGROUND_OPTIONS[0];
}
