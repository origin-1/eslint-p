# eslint-p · [![npm version][npm badge]][npm URL]

A drop-in replacement for ESLint 9 featuring multithreaded parallel linting.

> **IMPORTANT:** Legacy `.eslintrc` configuration is not supported.

## Installation

```shell
npm i --save-dev eslint-p
```

```shell
yarn add --dev eslint-p
```

```shell
pnpm add --save-dev eslint-p
```

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

> **NOTE**: Normally, a performance improvement **will be only noticeable on systems with 4 or more CPUs**.
> Some plugins like `typescript-eslint` with type-aware linting can increase the time required to initialize a linting thread resulting in performance degradation when multithreading is used.

## Mixed Usage with ESLint

This package has ESLint set as a dependency, so if you already have `eslint` installed, but with a different version than the one specified in the `package.json` of this package you might get inconsistent results between the CLI and the editor.

To check the version of ESLint used by this package you can use:

```shell
npx eslint-p -v
```

To avoid inconsistencies, install the same `eslint` version used by this package or remove the `eslint` dependency from your `package.json`.
You can find more information on [this pull request](https://github.com/origin-1/eslint-p/pull/1).

## Concurrency Debugging

When the `--debug` option is passed and the command runs in multithread mode, the debug output will include a line indicating the number of worker threads in use. For example:

```shell
npx eslint-p --debug
```

will print a line similar to:

```text
eslint:eslint Running 4 worker thread(s). +0ms
```

This line should be printed in the first seconds of execution, before any files are processed, but it can be easily overlooked.
To make the debug output less verbose in a Unix shell you can run instead:

```shell
DEBUG='eslint:eslint' npx eslint-p
```

Or in Windows PowerShell:

```shell
$env:DEBUG='eslint:eslint' ; npx eslint-p
```

If you don't see a lint containing `worker thread(s)` in the debug output, then the command is running in single-threaded mode, i.e. like ESLint itself.

## Multithread Linting in ESLint

ESLint has decided to integrate multithread linting as a built-in feature in an upcoming release.
You can follow [the related pull request](https://github.com/eslint/eslint/pull/19794) for more information.

[npm badge]: https://img.shields.io/npm/v/eslint-p?logo=npm
[npm URL]: https://www.npmjs.com/package/eslint-p
