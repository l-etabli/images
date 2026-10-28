# Images

- Read `README.md` first: its rules (generic only, readable immutable tags, no digests, no `latest`) are binding.
- This repository is public: never commit a project-specific value (bucket, endpoint, key, DSN, domain), even in examples or tests.
- Tests run scripts against fake CLIs (`test-helpers/fake-bin.ts`); do not use mocking helpers (`vi.fn`, `vi.mock`, `vi.spyOn`).
- Prefer object params over multiple positional arguments for functions with 2+ parameters.
- Before choosing a base image tag, check upstream releases and verify the packaged version by running the image.
