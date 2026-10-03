// Locators of the StudioChat test hooks (@trafficops/studio-ui/chat): data-testid, data-role, data-run-id, data-run-status.
// StudioChat is a lazy chunk: wait for `root` before using the other locators.
export function studioChat(scope) {
  const root = scope.locator('[data-testid="studio-chat"]');
  const composer = root.locator('[data-testid="studio-chat-composer"]');
  const feed = root.locator('[data-testid="studio-chat-feed"]');
  return {
    root,
    threads: root.locator('[data-testid="studio-chat-threads"]'),
    feed,
    composer,
    prompt: composer.locator('textarea'),
    send: composer.locator('button[type="submit"]'),
    scope: composer.locator('.studio-chat-scope'),
    // Unified assistant: project has no scope control; an explicit editor selection is removable context.
    activeScope: name => composer.locator(name === 'Project' ? '.studio-chat-composer-toolbar:not(:has(.studio-chat-scope))' : `.studio-chat-scope:has(button[aria-label=${JSON.stringify(`Remove ${name}`)}])`),
    attachmentInput: composer.locator('input[type="file"]'),
    user: feed.locator('[data-role="user"]'),
    assistant: feed.locator('[data-role="assistant"]'),
    run: id => feed.locator(`[data-run-id="${id}"]`),
    status: status => feed.locator(`[data-run-status="${status}"]`),
    cards: type => feed.locator(type ? `[data-testid="studio-chat-card"][data-card="${type}"]` : '[data-testid="studio-chat-card"]'),
    apply: feed.locator('[data-testid="studio-chat-apply"]'),
    discard: feed.locator('[data-testid="studio-chat-discard"]'),
    keepDraft: feed.locator('[data-testid="studio-chat-keep-draft"]'),
    continueRun: feed.locator('[data-testid="studio-chat-continue"]'),
    // Thread in the list (the list is hidden below 560 px of chat width; ChatHeader then offers it as a menu).
    thread: title => root.locator('[data-testid="studio-chat-threads"]').getByRole('button', { name: title, exact: true }),
    threadActions: title => root.locator('[data-testid="studio-chat-threads"]').getByRole('button', { name: `Conversation actions: ${title}`, exact: true }),
  };
}

// Opens a conversation: from the list when it is shown, otherwise from the header menu "Conversations"
// (the list is hidden by a container query while the chat is narrower than 560 px, e.g. next to the preview at 1280 px).
export async function openThread(chat, title) {
  if (await chat.threads.isVisible()) return chat.thread(title).click();
  await chat.root.locator('.studio-chat-header').getByRole('button', { name: 'Conversations', exact: true }).click();
  await chat.root.locator('.studio-chat-header').getByRole('menuitem', { name: title, exact: true }).click();
}

// Sends the composer text through the submit button (Enter goes through the same form submit).
export async function sendMessage(chat, text) {
  await chat.prompt.fill(text);
  await chat.send.click();
}

// Narrow Studio layouts show one panel at a time behind a bottom switch (Files / Edit / Preview); wide layouts show all
// panels and have no switch, so this is a no-op there.
export async function showPane(page, name) {
  await page.locator('.editor-shell.is-app > .studio-toolbar').waitFor();
  const panes = page.locator('.studio-pane-switch');
  if (await panes.isVisible()) await panes.getByRole('button', { name, exact: true }).click();
}

// Project navigation (New project, All projects, switching, Rename) lives in the menu behind the project name.
export async function projectMenuItem(page, name) {
  await page.locator('.studio-project-trigger').click();
  return page.getByRole('menu').getByRole('menuitem', { name, exact: true });
}
// Studio settings and secondary project actions (Save now, Save as template, OpenRouter, Quick start) live in ⋯.
export async function moreMenuItem(page, name) {
  await page.getByRole('button', { name: 'More options', exact: true }).click();
  return page.getByRole('menu', { name: 'More options' }).getByRole('menuitem', { name, exact: true });
}
// "New project": a button in the library, an item of the project menu in an open project.
export async function newProjectControl(page) {
  if (await page.locator('.studio-project-trigger').isVisible()) return projectMenuItem(page, 'New project');
  return page.getByRole('button', { name: 'New project', exact: true }).first();
}
// Explicit save: a "Save draft" button for hosts without autosave, "Save now" in ⋯ for autosaving hosts.
export async function saveNow(page) {
  const button = page.locator('.studio-toolbar').getByRole('button', { name: 'Save draft', exact: true });
  if (await button.isVisible()) return button.click();
  return (await moreMenuItem(page, 'Save now')).click();
}
export async function switchProject(page, name) { return (await projectMenuItem(page, name)).click(); }

// Reveal the conversation mode after a manual open or reload; a narrow workspace may currently show Preview.
export async function revealConversationTab(root) {
  const page = root.page(), panes = page.locator('.studio-pane-switch');
  if (await panes.isVisible()) await panes.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('tab', { name: 'Conversations', exact: true }).click();
}
