// playwright-cli run-code: run in a clean test browser, without the extension.
// Scripts run at document start on a routed fixture; no Yandex account is used.
async (page) => {
  const checks = [];
  const errors = [];
  const expected = value => (1000 ** value - 1) / 999;
  function check(ok, label, detail = "") {
    if (!ok) throw new Error(`${label}: ${detail}`);
    checks.push(label);
  }
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript({ path: "audio-engine.js" });
  await page.addInitScript({ path: "slider.js" });
  await page.route("https://quiet.test/native-slider", route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><title>Native slider regression fixture</title>
      <h1>Native slider regression fixture</h1>
      <label>Manage volume<input type="range" max="1" step="0.01" value="0.01" class="ChangeVolume_slider__test"></label>
      <label>Seek<input type="range" max="200" step="1" value="0"></label>
      <button id="play">Play quiet test tone</button>
      <script>
      window.player = new Audio(); player.id = 'player';
      player.volume = Number(localStorage.getItem('site-volume') || 0.01);
      document.body.append(player);
      const slider = document.querySelector('.ChangeVolume_slider__test');
      slider.value = player.volume;
      slider.oninput = () => {
        player.volume = Number(slider.value);
        localStorage.setItem('site-volume', player.volume);
      };
      </script>`,
  }));
  await page.goto("https://quiet.test/native-slider");
  const cdp = await page.context().newCDPSession(page);
  let isolated;
  async function native(selector = "#player") {
    if (!isolated) {
      const { frameTree } = await cdp.send("Page.getFrameTree");
      isolated = (await cdp.send("Page.createIsolatedWorld", {
        frameId: frameTree.frame.id, worldName: "native-audio-verification",
      })).executionContextId;
    }
    const { result } = await cdp.send("Runtime.evaluate", {
      contextId: isolated, returnByValue: true,
      expression: `document.querySelector(${JSON.stringify(selector)}).volume`,
    });
    return result.value;
  }
  async function volume(value, label, selector = "#player") {
    const actual = await native(selector);
    check(Math.abs(actual - value) < 1e-12, label, `expected ${value}, got ${actual}`);
  }
  await volume(expected(0.01), "Page-start player immediately uses quieter curve");
  check(await page.evaluate(() => player.volume) === 0.01, "Site getter retains slider position");
  check(await page.getByRole("slider", { name: "Manage volume" }).getAttribute("step") === "0.001", "Existing volume slider gets 0.1% steps");
  check(await page.getByRole("slider", { name: "Seek", exact: true }).getAttribute("step") === "1", "Seek slider is unchanged");
  for (const position of [0, 0.001, 0.01, 0.1, 0.5, 1]) {
    await page.getByRole("slider", { name: "Manage volume" }).fill(String(position));
    await volume(expected(position), `Original slider works at ${position * 100}%`);
  }
  await page.getByRole("slider", { name: "Manage volume" }).fill("0.01");
  await page.getByRole("slider", { name: "Manage volume" }).press("ArrowUp");
  await volume(expected(0.011), "Arrow key makes one fine step");
  await page.evaluate(() => { for (let i = 0; i < 100; i++) player.volume = player.volume; });
  await volume(expected(0.011), "Site read/write loop does not compound curve");
  await page.evaluate(() => { player.muted = true; player.volume = 0.1; });
  check(await page.evaluate(() => player.muted), "Site mute is preserved");
  await page.evaluate(() => { player.muted = false; });
  await volume(expected(0.1), "Unmute retains the curve");
  await page.evaluate(() => {
    window.next = new Audio(); next.id = "next"; next.volume = 0.2;
    document.body.append(next);
  });
  await volume(expected(0.2), "Replacement detached Audio inherits curve", "#next");
  await page.evaluate(() => {
    const media = document.createElement("video"); media.id = "video"; media.volume = 0.3;
    document.body.append(media);
  });
  await volume(expected(0.3), "DOM video uses same curve", "#video");
  const invalid = await page.evaluate(() => {
    const accepted = [];
    for (const v of [-1, 2, NaN, Infinity, undefined, Symbol("invalid")]) {
      try { player.volume = v; accepted.push(String(v)); } catch {}
    }
    return accepted;
  });
  check(invalid.length === 0, "Invalid native values still throw", invalid.join(", "));
  await page.evaluate(() => { document.querySelector('.ChangeVolume_slider__test').step = "0.01"; });
  check(await page.getByRole("slider", { name: "Manage volume" }).getAttribute("step") === "0.001", "React resetting step gets corrected");
  await page.getByRole("slider", { name: "Manage volume" }).fill("0.2");
  await page.reload(); isolated = undefined;
  await volume(expected(0.2), "Site-saved position works after reload");
  await page.evaluate(() => {
    const rate = 8000, samples = rate * 2;
    const bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer);
    const text = (offset, value) => [...value].forEach((c, i) => { bytes[offset + i] = c.charCodeAt(0); });
    text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVEfmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data");
    view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(i / rate * 440 * 2 * Math.PI) * 300, true);
    player.src = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
    document.getElementById("play").onclick = () => player.play();
  });
  await page.getByRole("button", { name: "Play quiet test tone" }).click();
  await page.waitForFunction(() => player.currentTime > 0.05);
  check(await page.evaluate(() => !player.paused && !player.error), "Real media decodes and plays");
  await page.evaluate(() => player.pause());
  await volume(expected(0.2), "Source replacement preserves curve");
  check(errors.length === 0, "No page errors", errors.join("; "));
  await cdp.detach();
  return { passed: checks.length, checks };
}
