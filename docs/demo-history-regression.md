# Demo history regression

The review of PR #2 found that browser Back from the initially seeded account reached the original hashless URL while retaining account details, statement rows and selection. The published demo reproduced this behavior before the fix.

History entries without a valid account now clear selection, pagination and statement rows, and hide the account panels. Forward to a valid account reloads its balance and statement. The Back to accounts button uses the same clearing behavior. Movement and Statement links scroll and focus within the selected account without inserting non-account history entries.

The manual browser regression is `tests/browser/history.js`; Vitest does not run this script. Run it with Playwright CLI from `output/playwright` after starting `npm run preview:demo` in a separate terminal:

```powershell
npx --yes --package @playwright/cli playwright-cli -s=keel-history open http://localhost:4173/ --browser chrome
npx --yes --package @playwright/cli playwright-cli -s=keel-history run-code --filename ../../tests/browser/history.js
```

Use a distinct browser session to avoid interfering with another project. The same script can validate the published URL by opening it instead of localhost. It covers desktop/mobile Back and Forward to hashless, overview, missing-account, empty-account and unknown hashes, restoration of controls and entries, section navigation/focus and console errors. Screenshots are written to the CLI working directory.

Local validation passed 239 assertions with zero console errors; the existing 40-check demo flow also passed. API/unit tests remain 93 passed locally, with the seven database tests skipped unless `KEEL_TEST_DATABASE_URL` is provided. CI runs those seven against ephemeral PostgreSQL, and the Pages workflow gates its exact revision before deployment. These browser checks remain manual and must be recorded separately from CI.
