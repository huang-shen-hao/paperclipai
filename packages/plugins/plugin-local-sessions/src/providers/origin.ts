/**
 * Sessions Paperclip itself starts are titled with this prefix by the local
 * adapters, which lets the UI label them as platform-originated work.
 */
export const PAL_ORIGIN_LABEL = "Paperclip";

/**
 * Boilerplate the Codex desktop app prepends to the *first* user turn. The
 * actual request lives after the marker, so titles prefer that segment.
 */
export const CODEX_REQUEST_MARKER = "## My request:";

export function titleFromCodexUserText(text: string): string {
  const markerIndex = text.lastIndexOf(CODEX_REQUEST_MARKER);
  if (markerIndex >= 0) return text.slice(markerIndex + CODEX_REQUEST_MARKER.length);
  return text;
}
