// Open the demo in playwright-cli, then run-code --filename tests/browser/history.js.
// biome-ignore format: playwright-cli requires a function expression without a trailing semicolon.
async (page) => {
  const base = new URL(page.url());
  base.hash = '';
  const checks = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const assert = (condition, label) => {
    if (!condition) throw new Error(label);
    checks.push(label);
  };
  const ready = () =>
    page.waitForFunction(
      () => document.getElementById('workspace').getAttribute('aria-busy') === 'false',
    );
  async function overview(label) {
    await ready();
    assert(!(await page.locator('#detail').isVisible()), `${label}: details hidden`);
    assert(!(await page.locator('#statement-card').isVisible()), `${label}: statement hidden`);
    assert(!(await page.locator('#transfer-card').isVisible()), `${label}: transfer hidden`);
    assert(
      (await page.locator('#accounts button[aria-current="true"]').count()) === 0,
      `${label}: no selected account`,
    );
    assert((await page.locator('#statement tr').count()) === 0, `${label}: stale entries cleared`);
  }
  async function selected(hash, label) {
    await ready();
    assert((await page.evaluate(() => location.hash)) === hash, `${label}: account URL restored`);
    assert(
      (await page.locator('#detail').isVisible()) &&
        (await page.locator('#statement-card').isVisible()) &&
        (await page.locator('#transfer-card').isVisible()),
      `${label}: account panels restored`,
    );
    assert(
      (await page.locator('#accounts button[aria-current="true"]').count()) === 1,
      `${label}: one selected account`,
    );
    assert((await page.locator('#statement tr').count()) > 0, `${label}: entries reloaded`);
    assert(!(await page.locator('#dep-amt').isDisabled()), `${label}: movement controls restored`);
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.goto('about:blank');
    await page.goto(base.href);
    await ready();
    const accountHash = await page.evaluate(() => location.hash);
    await selected(accountHash, `${width}px boot`);
    await page.goBack();
    assert(
      (await page.evaluate(() => location.hash)) === '',
      `${width}px Back reaches hashless URL`,
    );
    await overview(`${width}px hashless Back`);
    await page.screenshot({ path: `overview-${width}.png`, fullPage: true });
    await page.goForward();
    await selected(accountHash, `${width}px Forward`);
    for (const name of ['Movement', 'Statement']) {
      await page.getByRole('link', { name, exact: true }).click();
      await selected(accountHash, `${width}px ${name} section link`);
      assert(
        (await page.evaluate(() => document.activeElement.id)) ===
          (name === 'Movement' ? 'detail' : 'statement-card'),
        `${width}px ${name} focus`,
      );
    }
    await page.locator('#btn-back').click();
    await overview(`${width}px Back to accounts`);
    assert(
      await page.evaluate(() => document.activeElement.classList.contains('account')),
      `${width}px overview keyboard focus`,
    );
    await page.goBack();
    await selected(accountHash, `${width}px Back from overview`);
    await page.goForward();
    await overview(`${width}px Forward to overview`);
    for (const hash of ['#account=missing', '#account=', '#unknown']) {
      await page.locator('#accounts .account').nth(0).click();
      await ready();
      const previousHash = await page.evaluate(() => location.hash);
      await page.evaluate((value) => history.pushState(null, '', value), hash);
      await page.goBack();
      await selected(previousHash, `${width}px Back before invalid ${hash}`);
      await page.goForward();
      await overview(`${width}px invalid ${hash}`);
      await page.locator('#accounts .account').nth(0).click();
      await ready();
      const validHash = await page.evaluate(() => location.hash);
      await selected(validHash, `${width}px selection after invalid ${hash}`);
      await page.goBack();
      await overview(`${width}px Back to invalid ${hash}`);
      await page.goForward();
      await selected(validHash, `${width}px Forward after invalid ${hash}`);
    }
  }
  assert(errors.length === 0, `no console errors: ${JSON.stringify(errors)}`);
  return { passed: checks.length, checks, errors };
}
