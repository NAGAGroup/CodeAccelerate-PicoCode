# AGENTS.md

The project being worked on is a C++ greenfield project where dependencies and toolchains are managed by the `pixi` package manager with a `CPM.cmake` fallback for dependencies not available through `pixi`.

## Project Orientation

- `README.md`
- `CMakeLists.txt`
- `CMakePresets.json`
- `pixi.toml`

## Pixi Usage

- Documentation: https://pixi.prefix.dev/latest/
- `pixi info` project overview
- `pixi search` to search for dependencies, supports glob patterns
- `pixi add` adds dependencies to the project
- `pixi task list` for listing project tasks
- `pixi run -e dev <task name>` run a pixi task within the dev environment
- `pixi run -e dev "<shell command> <args/flags>..."` for running shell commands within the dev environment

## CPM.cmake

- Repo: https://github.com/cpm-cmake/cpm.cmake
- Wraps `FetchContent` to make adding external sources much more straightforward
