# eslint-p · [![npm version][npm badge]][npm URL]

A drop-in replacement for ESLint 9 featuring multithreaded parallel linting.

**IMPORTANT:** Legacy eslintrc configuration is not supported.

## Usage

All [ESLint CLI options](https://eslint.org/docs/latest/use/command-line-interface#options) are supported, plus `--concurrency` to specify the number of linting threads explicitly.

Example:

```shell
npx eslint-p --fix --concurrency=4
```

Valid values for the `--concurrency` option are:

* **positive integers (e.g. `4`)**:
  Maximum number of linting threads. The effective number of threads can be lower when linting only a few files.
* **`auto`**:
  Choose number of linting threads automatically (default).
* **`off`**:
  No multithreading, run like ESLint. This is not the same as `--concurrency=1`.

Normally, a performance improvement will be only noticeable on systems with 4 or more CPUs.

[npm badge]: https://img.shields.io/npm/v/eslint-p?logo=npm
[npm URL]: https://www.npmjs.com/package/eslint-p
