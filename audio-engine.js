(() => {
  "use strict";
  const prototype = HTMLMediaElement.prototype;
  const volume = Object.getOwnPropertyDescriptor(prototype, "volume");
  const requestedVolumes = new WeakMap();

  // Continuous audio taper: quiet control near zero, original full volume at 1.
  // 1% -> 0.0072%, 10% -> 0.0996%, 50% -> 3.065%, 100% -> 100%.
  function taper(position) {
    if (position === 0 || position === 1) return position;
    return Math.expm1(position * Math.log(1000)) / 999;
  }

  function track(media) {
    if (!requestedVolumes.has(media)) {
      requestedVolumes.set(media, volume.get.call(media));
      apply(media);
    }
  }

  function apply(media) {
    const output = taper(requestedVolumes.get(media));
    if (volume.get.call(media) !== output) volume.set.call(media, output);
  }

  Object.defineProperty(prototype, "volume", {
    ...volume,
    get() {
      // Native call preserves illegal-receiver errors.
      const actual = volume.get.call(this);
      return requestedVolumes.has(this) ? requestedVolumes.get(this) : actual;
    },
    set(value) {
      volume.get.call(this);
      const numeric = +value;
      // Delegate invalid values to Chrome to preserve its native exceptions.
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
        volume.set.call(this, numeric);
        return;
      }
      track(this);
      requestedVolumes.set(this, numeric);
      apply(this);
    },
  });

  // Yandex may create detached Audio objects and replace them between tracks.
  window.Audio = new Proxy(window.Audio, {
    construct(target, args, newTarget) {
      const media = Reflect.construct(target, args, newTarget);
      track(media);
      return media;
    },
  });
  for (const name of ["play", "load"]) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    Object.defineProperty(prototype, name, {
      ...descriptor,
      value: function (...args) {
        track(this);
        return Reflect.apply(descriptor.value, this, args);
      },
    });
  }
  for (const name of ["src", "srcObject", "autoplay"]) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (!descriptor?.set) continue;
    Object.defineProperty(prototype, name, {
      ...descriptor,
      set(value) {
        track(this);
        descriptor.set.call(this, value);
      },
    });
  }

  function scan(node) {
    if (node instanceof HTMLMediaElement) track(node);
    if (node.querySelectorAll) node.querySelectorAll("audio, video").forEach(track);
  }
  new MutationObserver(records => {
    for (const record of records) record.addedNodes.forEach(scan);
  }).observe(document, { childList: true, subtree: true });
  for (const name of ["play", "loadstart", "loadedmetadata"]) {
    document.addEventListener(name, event => {
      if (event.target instanceof HTMLMediaElement) track(event.target);
    }, true);
  }

  scan(document);
})();
