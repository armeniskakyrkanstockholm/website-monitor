# website-monitor

Watches armeniskakyrkansverige.se from outside. Every hour it asks the live site for every file the last deploy published and compares each one with what the deploy said it should be. If anything differs, the run fails and an issue is opened, and GitHub emails the owners.

It is a separate repository, and a public one, for two reasons (record 0009 of the website repository):

- **Independence.** What the site should be is written here by the website's deploy job and is never read from the site. Someone who changed the site could not change this too.
- **Cost.** Public repositories run Actions for free. A private repository's monthly allowance is limited and shared with the website's own tests, and an hourly check would take a large part of it. Nothing here is secret: the fingerprints and header names describe a public site.

## What it checks

For each environment in `TARGETS` (`.github/workflows/integrity.yml`):

- every file in `expected/<branch>.json` answers 200 with exactly the bytes the deploy published (SHA-256);
- every response carries exactly the security headers the build sets, and none the server is set not to send (`X-Powered-By`), and no `X-Robots-Tag` unless the build sets one (staging does; the live site must not);
- `/.git/config`, `/.git/HEAD`, `/.release.json`, `/.htaccess` and `/.env` are refused with 403 or 404;
- the certificate is accepted and has at least 14 days left.

A difference counts only if it is still there two minutes later, against the manifest read again, because the server takes a moment to pull a deploy.

## What an alert means

The run fails and the issue "The live site differs from what was deployed" lists what is different, in words. The monitor alerts and does not repair. Look at the site, then at the last deploy in the website repository. If a deploy has just gone out, wait for the next run: the issue is updated in place, and a passing run leaves it for you to close.

## Where the expectations come from

`expected/staging.json` and `expected/production.json` are written by the website repository's Staging and Production workflows, after they publish, with a deploy key that can write to this repository and nothing else. Their format is `src/deploy/monitor.ts` there; `src/manifest.ts` here reads it strictly, and `test/fixtures/expected-staging.json` is a real one.

## What it cannot see

It sees a file that changed. It does not see a file added under a name that nothing links to, since there is no list of what a server holds to compare with. It sees the site as the world does, so a change that only some visitors get (by country, say) may not show.

## Running it and the tests

Node 24. The check itself needs no packages:

    TARGETS=staging node src/check.ts

The type check and the tests need the two development packages in `package.json` (TypeScript and the Node types, pinned exactly, install scripts off):

    npm ci
    npm run check
    npm test

`.github/workflows/checks.yml` runs them on every push and pull request. It holds no secret.

## Licence

MIT, see `LICENSE`.
