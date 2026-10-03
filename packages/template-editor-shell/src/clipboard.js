// Preview creation can finish after focus has moved into the preview iframe.
// Clipboard failure must not hide an already-created preview URL.
export async function copyPreviewLink(value, win = window, doc = document, nav = navigator) {
  try {
    win.focus();
    await nav.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
