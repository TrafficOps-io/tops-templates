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
    attachmentInput: composer.locator('input[type="file"]'),
    user: feed.locator('[data-role="user"]'),
    assistant: feed.locator('[data-role="assistant"]'),
    run: id => feed.locator(`[data-run-id="${id}"]`),
    status: status => feed.locator(`[data-run-status="${status}"]`),
    cards: type => feed.locator(type ? `[data-testid="studio-chat-card"][data-card="${type}"]` : '[data-testid="studio-chat-card"]'),
    apply: feed.locator('[data-testid="studio-chat-apply"]'),
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
