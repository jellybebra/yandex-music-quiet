(() => {
  "use strict";
  // This is Yandex's existing vertical volume input, not the track seek bar.
  // Match the component name rather than a translated accessible label.
  const selector = 'input[type="range"][class*="ChangeVolume_slider"]';
  function refine(node) {
    if (!(node instanceof Element)) return;
    if (node.matches(selector) && Number(node.max) === 1 && node.step !== "0.001") {
      node.step = "0.001";
    }
    node.querySelectorAll(selector).forEach(refine);
  }
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") refine(record.target);
      else record.addedNodes.forEach(refine);
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["step"] });
  refine(document.documentElement);
})();
