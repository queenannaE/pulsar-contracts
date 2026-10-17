# Versioning Policy

Pulsar Contract follows [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html)
(`MAJOR.MINOR.PATCH`).

## Version increments

| Increment | When to use |
|-----------|-------------|
| **MAJOR** | Breaking ABI change — any change to public function signatures, removed functions, or changed `#[contracttype]` layouts that would break existing callers or stored data. |
| **MINOR** | Backwards-compatible new functionality — new public functions, new optional parameters, new event topics, or new storage keys that do not affect existing callers. |
| **PATCH** | Backwards-compatible bug fixes, documentation updates, internal refactors, or dependency bumps that do not change the public ABI. |

## Release process

1. Decide the new version number using the table above.
2. Update the version field in `contracts/payment-processing-contract/Cargo.toml`:
   ```toml
   [package]
   version = "x.y.z"
   ```
3. Add a new `## [x.y.z] - YYYY-MM-DD` section at the top of [CHANGELOG.md](../CHANGELOG.md)
   describing all changes under the standard headings (`Added`, `Changed`, `Deprecated`,
   `Removed`, `Fixed`, `Security`).
4. Commit with message `chore(release): bump version to x.y.z`.
5. Push the commit and open a pull request against `main`.
6. Once the PR is merged, CI (`release.yml`) automatically:
   - Reads the version from `Cargo.toml`.
   - Checks whether a `v<x.y.z>` tag already exists.
   - Creates the tag and a GitHub Release with release notes extracted from `CHANGELOG.md`.
   - The CI `release` job in `ci.yml` also builds the WASM binary and uploads it—along
     with its SHA-256 checksum—to the GitHub Release as permanent assets.

## Pre-release versions

Append a pre-release suffix when shipping alpha or release-candidate builds:

```
0.2.0-alpha.1
0.2.0-rc.1
```

These follow semver pre-release semantics. CI will still tag and create a GitHub Release
for pre-release versions; consumers should pin exact versions for pre-releases.

## Changelog format

Follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/):

```markdown
## [x.y.z] - YYYY-MM-DD

### Added
- …

### Changed
- …

### Fixed
- …
```

The `[Unreleased]` section at the top of `CHANGELOG.md` accumulates changes that are
on `main` but not yet tagged. Move its contents to a versioned section when cutting a
release.
