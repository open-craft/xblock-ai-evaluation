import { useLayoutEffect, useRef } from "react";

/**
 * Focus the returned element, without scrolling, when ``isOpen`` becomes true.
 *
 * Paragon's ``ModalPopup`` focuses the popup before Popper has moved it next to
 * its target, so the browser scrolls to where the popup was first drawn. Focusing
 * first, without scrolling, keeps the page where it is: the focus lock leaves
 * focus alone when it's already inside the popup.
 */
export function useFocusWithoutScroll<T extends HTMLElement>(isOpen: boolean) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    if (isOpen) {
      ref.current?.focus({ preventScroll: true });
    }
  }, [isOpen]);
  return ref;
}
