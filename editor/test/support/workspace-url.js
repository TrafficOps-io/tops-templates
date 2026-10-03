// Workspace scenarios enter explicitly; '/' is the public product website.
export function workspaceUrl(value) {
  const url = new URL(value);
  url.searchParams.set('studio', '1');
  return url.href;
}

// Persistence tests explicitly reopen after an installed launch returns to Projects.
// Tests of launch behavior itself use page.reload() and assert the library directly.
export async function reloadProject(page) {
  const name = await page.locator('.studio-project-name').innerText();
  await page.reload();
  await page.locator('.library, .editor-shell').first().waitFor();
  if (await page.locator('.library').isVisible()) {
    await page.getByRole('button', { name: `Open ${name}`, exact: true }).click();
    await page.locator('.editor-shell').waitFor();
  }
}
