# Assistant regression coverage

These four suites were transferred from `ordaxsystems/ordax-os` at
`9ee1bdaa` (the `tests/test_assistant_{conversation,submission_state,result_canvas,work_strip}.mjs`
files). They exercise the canonical portable Assistant source in this repository,
including account/Space isolation, cancellation, Memory capture boundaries,
safe result rendering, submission races and read-only Work presentation.

Run from the repository root:

```sh
ORDAX_ASSISTANT_TEST_OS_ROOT=/path/to/ordax-os node --test apps/assistant/tests/*.test.mjs
```

The Work integration suite uses the real OS Personal OrdaX runtime, Work Canvas
projection and activation channel through `../test-support/platform.mjs`.
This dependency is test-only, outside the app's `src/` graph; it does not bundle
OS services or create another runtime owner. Foundation CI supplies its existing
observed canonical OS checkout at `.ordax-assistant-os-main`.

The two old source assertions that required the OS to mount an embedded Assistant
now require its absence while checking the portable app consumes supplied ports.
No inference, install, grant or production activation gate is enabled by these tests.
