<a name="v0.23.0"></a>
## [v0.23.0](https://github.com/origin-1/eslint-p/releases/tag/v0.23.0) (2025-05-17)

This release updates the used ESLint version to [v9.27.0](https://eslint.org/blog/2025/05/eslint-v9.27.0-released/).

<a name="v0.22.0"></a>
## [v0.22.0](https://github.com/origin-1/eslint-p/releases/tag/v0.22.0) (2025-05-03)

This release updates the used ESLint version to [v9.26.0](https://eslint.org/blog/2025/05/eslint-v9.26.0-released/).

<a name="v0.21.0"></a>
## [v0.21.0](https://github.com/origin-1/eslint-p/releases/tag/v0.21.0) (2025-04-22)

This release updates the used ESLint version to [v9.25.1](https://eslint.org/blog/2025/04/eslint-v9.25.1-released/).

<a name="v0.20.0"></a>
## [v0.20.0](https://github.com/origin-1/eslint-p/releases/tag/v0.20.0) (2025-03-22)

This release updates the used ESLint version to [v9.23.0](https://eslint.org/blog/2025/03/eslint-v9.23.0-released/).

<a name="v0.19.0"></a>
## [v0.19.0](https://github.com/origin-1/eslint-p/releases/tag/v0.19.0) (2025-03-08)

This release updates the used ESLint version to [v9.22.0](https://eslint.org/blog/2025/03/eslint-v9.22.0-released/).
The [README file](https://github.com/origin-1/eslint-p/blob/main/README.md) has been extended with instructions on how to debug the number of worker threads in use, and a paragraph about the ESLint multithread linting RFC.

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
