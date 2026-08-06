/**
 * Right-side detail drawer (order | location | metric | alert).
 */

let openState = null;
let keyHandler = null;

export function isDrawerOpen() {
  return Boolean(openState);
}

export function getDrawerState() {
  return openState;
}

export function closeDrawer(els) {
  openState = null;
  if (!els?.root) return;
  els.root.hidden = true;
  els.root.setAttribute("aria-hidden", "true");
  document.body.classList.remove("drawer-open");
  if (keyHandler) {
    document.removeEventListener("keydown", keyHandler);
    keyHandler = null;
  }
}

export function openDrawer(els, { type, title, bodyHtml, meta = {} }) {
  openState = { type, title, meta };
  els.root.hidden = false;
  els.root.setAttribute("aria-hidden", "false");
  els.title.textContent = title;
  els.body.innerHTML = bodyHtml;
  document.body.classList.add("drawer-open");
  els.panel?.focus?.();

  if (keyHandler) document.removeEventListener("keydown", keyHandler);
  keyHandler = (e) => {
    if (e.key === "Escape") closeDrawer(els);
  };
  document.addEventListener("keydown", keyHandler);
}

export function bindDrawerChrome(els, { onClose } = {}) {
  els.backdrop?.addEventListener("click", () => {
    closeDrawer(els);
    onClose?.();
  });
  els.close?.addEventListener("click", () => {
    closeDrawer(els);
    onClose?.();
  });
}
