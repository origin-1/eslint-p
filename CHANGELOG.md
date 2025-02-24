<a name="v0.18.0"></a>
## [v0.18.0](https://github.com/origin-1/eslint-p/releases/tag/v0.18.0) (2025-02-24)

This release updates the used ESLint version to [v9.21.0](https://eslint.org/blog/2025/02/eslint-v9.21.0-released/).

<a name="v0.17.0"></a>
## [v0.17.0](https://github.com/origin-1/eslint-p/releases/tag/v0.17.0) (2025-01-25)

This release updates the used ESLint version to [v9.19.0](https://eslint.org/blog/2025/01/eslint-v9.19.0-released/).

<a name="v0.16.0"></a>
## [v0.16.0](https://github.com/origin-1/eslint-p/releases/tag/v0.16.0) (2025-01-12)

This release updates the used ESLint version to [v9.18.0](https://eslint.org/blog/2025/01/eslint-v9.18.0-released/).

<a name="v0.15.0"></a>
## [v0.15.0](https://github.com/origin-1/eslint-p/releases/tag/v0.15.0) (2024-11-24)

Previously, if less than 4 CPUs were available, eslint-p would run in multithread mode by default but using just one worker thread for linting.
In this release, eslint-p defaults to running in single-thread mode like ESLint when it detects less than 4 available CPUs.
It's always possible to enable multithread mode explicitly by setting the `--concurrency` option to a number, e.g. `--concurrency=2`.

<a name="v0.14.0"></a>
## [v0.14.0](https://github.com/origin-1/eslint-p/releases/tag/v0.14.0) (2024-11-19)

This release updates the used ESLint version to [v9.15.0](https://eslint.org/blog/2024/11/eslint-v9.15.0-released/).
The [README file](https://github.com/origin-1/eslint-p/blob/main/README.md) has been expanded with installation instructions, notes about using eslint-p alongside ESLInt, and more.

<a name="v0.13.0"></a>
## [v0.13.0](https://github.com/origin-1/eslint-p/releases/tag/v0.13.0) (2024-11-02)

This release adds a [changelog file](https://github.com/origin-1/eslint-p/blob/main/CHANGELOG.md) to the project's repository, and marks the introduction of [GitHub releases](https://github.com/origin-1/eslint-p/releases).
The currently used ESLint version is [v9.14.0](https://eslint.org/blog/2024/11/eslint-v9.14.0-released/).
