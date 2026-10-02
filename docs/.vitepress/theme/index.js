import DefaultTheme from 'vitepress/theme';
import {useRoute} from 'vitepress';
import {defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import '@fontsource-variable/onest';
import './style.css';
import DocsHome from './DocsHome.vue';

function setAttribute(element, name, value) {
  if (value == null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== String(value)) {
    element.setAttribute(name, String(value));
  }
}

// Adapt the stock local-search semantics without replacing its result model,
// hrefs, keyboard handlers, focus trap or lazy loading. VitePress 1.6 nests a
// search form in role=button and result links in role=option list items.
function syncLocalSearchSemantics(popup) {
  if (!popup.isConnected) return;
  setAttribute(popup, 'role', 'dialog');
  setAttribute(popup, 'aria-modal', 'true');
  for (const attribute of ['aria-expanded', 'aria-haspopup', 'aria-owns']) setAttribute(popup, attribute, null);
  // These non-interactive key glyphs need a nameable role to retain their
  // existing translated arrow/Enter/Escape labels.
  for (const hint of popup.querySelectorAll('.search-keyboard-shortcuts kbd[aria-label]')) setAttribute(hint, 'role', 'img');

  const input = popup.querySelector('#localsearch-input');
  const list = popup.querySelector('.results');
  if (!input || !list) return;
  const options = [...list.querySelectorAll('a.result[data-index]')];
  for (const option of options) {
    const parent = option.closest('li');
    if (!parent) continue;
    setAttribute(parent, 'role', 'presentation');
    setAttribute(parent, 'id', null);
    setAttribute(parent, 'aria-selected', null);
    setAttribute(option, 'role', 'option');
    setAttribute(option, 'id', `localsearch-item-${option.dataset.index}`);
    setAttribute(option, 'aria-selected', option.classList.contains('selected'));
  }
  const selected = options.find(option => option.classList.contains('selected'));
  setAttribute(list, 'role', options.length ? 'listbox' : null);
  setAttribute(list, 'id', options.length ? 'localsearch-list' : null);
  setAttribute(input, 'role', 'combobox');
  setAttribute(input, 'aria-haspopup', 'listbox');
  setAttribute(input, 'aria-expanded', options.length > 0);
  setAttribute(input, 'aria-controls', options.length ? list.id : null);
  setAttribute(input, 'aria-activedescendant', selected?.id);
}

// Preserve VitePress navigation and search, adapting theme landmarks and search
// accessibility. The lazy search button may mount after the layout.
const Layout = defineComponent({
  setup() {
    const layout = ref();
    const route = useRoute();
    let searchObserver;
    let popupObserver;
    let bodyObserver;
    let activePopup;
    let removePopupListeners;
    let removeSearchListeners;
    let searchReturnTarget;
    let searchReturnPath;
    let searchNavigating = false;
    let restoreTimer;
    let restoreFrame;

    function syncContentTarget() {
      const root = layout.value?.$el;
      if (!(root instanceof HTMLElement)) return;
      const content = root.querySelector('.VPContent main, .VPContent .NotFound');
      const skipLink = root.querySelector('.VPSkipLink');
      if (content && skipLink) {
        content.id = 'docs-main-content';
        if (content.tagName !== 'MAIN') content.setAttribute('role', 'main');
        skipLink.setAttribute('href', '#docs-main-content');
      }
    }

    onMounted(async () => {
      await nextTick();
      syncContentTarget();
      const search = layout.value?.$el?.querySelector('.VPNavBarSearch');
      if (!search) return;
      const hideShortcutHint = () => {
        search.querySelectorAll('.DocSearch-Button-Keys').forEach(hint => hint.setAttribute('aria-hidden', 'true'));
      };
      hideShortcutHint();
      searchObserver = new MutationObserver(hideShortcutHint);
      searchObserver.observe(search, {childList: true, subtree: true});

      const rememberSearchFocus = event => {
        if (activePopup?.isConnected) return;
        const trigger = event.target instanceof Element && event.target.closest('.DocSearch-Button');
        const editing = event.target instanceof Element && (event.target.matches('input, textarea, select') || event.target.isContentEditable);
        const shortcut = event.type === 'keydown' && ((event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !editing));
        if (!trigger && !shortcut) return;
        const focused = document.activeElement;
        searchReturnTarget = trigger || (focused !== document.body ? focused : search.querySelector('.DocSearch-Button'));
        searchReturnPath = route.path;
      };
      document.addEventListener('click', rememberSearchFocus, true);
      document.addEventListener('keydown', rememberSearchFocus, true);
      removeSearchListeners = () => {
        document.removeEventListener('click', rememberSearchFocus, true);
        document.removeEventListener('keydown', rememberSearchFocus, true);
      };

      const watchPopup = () => {
        const popup = document.querySelector('.VPLocalSearchBox');
        if (popup === activePopup) return;
        if (activePopup && !popup && !searchNavigating) {
          const target = searchReturnTarget?.isConnected ? searchReturnTarget : search.querySelector('.DocSearch-Button');
          const path = searchReturnPath;
          // The stock trap can capture its already-focused input on mount.
          // Restore the actual opener after its deferred teardown completes.
          restoreTimer = setTimeout(() => {
            restoreFrame = requestAnimationFrame(() => {
              if (!activePopup && route.path === path && target?.isConnected) target.focus();
            });
          }, 0);
        }
        popupObserver?.disconnect();
        removePopupListeners?.();
        activePopup = popup;
        if (!popup) return;
        clearTimeout(restoreTimer);
        cancelAnimationFrame(restoreFrame);
        searchNavigating = false;
        const resultNavigation = event => {
          const result = event.target instanceof Element && event.target.closest('a.result');
          if ((event.type === 'click' && result) || (event.type === 'keydown' && event.key === 'Enter' && (result || event.target instanceof HTMLInputElement) && popup.querySelector('.result.selected'))) searchNavigating = true;
        };
        popup.addEventListener('click', resultNavigation, true);
        popup.addEventListener('keydown', resultNavigation, true);
        removePopupListeners = () => {
          popup.removeEventListener('click', resultNavigation, true);
          popup.removeEventListener('keydown', resultNavigation, true);
        };
        syncLocalSearchSemantics(popup);
        popupObserver = new MutationObserver(() => syncLocalSearchSemantics(popup));
        popupObserver.observe(popup, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'id', 'role', 'data-index', 'aria-selected', 'aria-owns', 'aria-controls', 'aria-activedescendant'],
        });
      };
      watchPopup();
      // The search box is teleported directly into body; observe only these
      // top-level mounts, then observe the active search subtree separately.
      bodyObserver = new MutationObserver(watchPopup);
      bodyObserver.observe(document.body, {childList: true});
    });
    watch(() => route.path, async () => {
      await nextTick();
      syncContentTarget();
    }, {flush: 'post'});
    onBeforeUnmount(() => {
      searchObserver?.disconnect();
      popupObserver?.disconnect();
      bodyObserver?.disconnect();
      removePopupListeners?.();
      removeSearchListeners?.();
      clearTimeout(restoreTimer);
      cancelAnimationFrame(restoreFrame);
    });

    return () => h(DefaultTheme.Layout, {ref: layout});
  },
});

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({app}) {
    app.component('DocsHome', DocsHome);
  },
};
