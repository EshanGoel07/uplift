# AGENTS.md

Guidelines for AI coding agents working in this repository.

## General principles

- Read the task carefully before changing anything. Make sure you understand what is being asked.
- Explore the codebase first: find the relevant modules, read the surrounding code, and look at
  how similar problems were solved elsewhere in the project.
- Prefer small, focused changes. Do one thing at a time and keep the diff minimal.
- Follow the existing code style and conventions. Consistency matters more than personal taste.
- Do not refactor unrelated code. Do not rename things unless the task requires it.
- Never leave debugging code, print statements or commented-out code behind.
- If something is unclear, state your assumptions explicitly.

## Before you write code

1. Reproduce the problem. Write a minimal example that shows the bug.
2. Find the root cause instead of patching the symptom.
3. Think about edge cases: empty inputs, None values, unusual types, large inputs.
4. Check whether the same bug exists in similar code paths and fix them consistently.

## Writing code

- Write clear, readable code with descriptive names.
- Keep functions short and single-purpose.
- Handle errors explicitly. Do not silently swallow exceptions.
- Avoid premature optimisation; correctness first.
- Add type hints where the surrounding code uses them.
- Add comments only where the intent is not obvious from the code.
- Do not introduce new dependencies.

## Testing

- Run the existing test suite before and after your change.
- Add a regression test for every bug you fix. The test should fail before your fix and pass
  after it.
- Test edge cases, not just the happy path.
- Never delete or weaken existing tests to make them pass.
- If tests fail for reasons unrelated to your change, note it rather than "fixing" the tests.

## Code quality

- Run the linter and formatter used by the project before finishing.
- Make sure there are no unused imports or variables.
- Keep public APIs backwards compatible unless the task says otherwise.
- Update documentation and docstrings if behaviour changes.

## Git hygiene

- Do not commit generated files, build artefacts or secrets.
- Keep changes limited to the files that need to change.

## Before you finish

- Re-read your diff from top to bottom.
- Confirm the original problem is solved.
- Confirm all tests pass.
- Confirm the linter is clean.
- Summarise what you changed and why.
