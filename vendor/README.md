# vendor/

Packages that are not published to the npm registry, kept in the repository so installs do not
depend on a third-party download server.

## xlsx-0.20.3.tgz (SheetJS Community Edition)

- Source: https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz. SheetJS stopped publishing to npm
  after 0.18.5, which has high advisories (prototype pollution GHSA-4r6h-8v6p-xvw6, ReDoS
  GHSA-5pgg-2g8v-p4x9). See #236.
- sha512: `oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==`
  (also pinned in bun.lock)
- Used by `lib/features/leads/import-service.ts` (lead import in the browser)

To update it, download the new tarball from cdn.sheetjs.com into this folder and run
`bun add ./vendor/xlsx-<version>.tgz`. Then delete the old tarball, and check bun.lock for a
leftover `"xlsx"` line (`bun add` has left a duplicate key there before).
