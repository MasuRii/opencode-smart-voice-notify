# Contributing to OpenCode Smart Voice Notify

Thank you for your interest in contributing to OpenCode Smart Voice Notify! This document provides guidelines for development, testing, and submitting contributions.

## Development Environment Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/MasuRii/opencode-smart-voice-notify.git
   cd opencode-smart-voice-notify
   ```

2. **Install dependencies**:
   We recommend using [Bun](https://bun.sh) for the fastest development experience, but `npm` also works.
   ```bash
   bun install
   # or
   npm install
   ```

3. **Link to OpenCode**:
   Add the local path to your `~/.config/opencode/opencode.json`:
   ```json
   {
     "plugin": ["file:///path/to/opencode-smart-voice-notify"]
   }
   ```

## Testing Guidelines

We take testing seriously. All new features and bug fixes should include appropriate tests.

### Running Tests

The project uses Bun's built-in test runner.

```bash
# Run all tests
bun test

# Run tests with coverage report
bun test --coverage

# Run tests in watch mode (useful during development)
bun test --watch

# Run a specific test file
bun test tests/unit/config.test.js
```

### Test File Naming & Location

- **Unit Tests**: Place in `tests/unit/`. Name files as `[module].test.js`.
- **E2E Tests**: Place in `tests/e2e/`. Name files as `[feature].test.js`.
- **Integration Tests**: Place in `tests/integration/`. These tests use real API credentials.

### Test Infrastructure

We provide a comprehensive test setup in `tests/setup.js` which is preloaded for all tests. It includes utilities for:

- **Filesystem Isolation**: `createTestTempDir()` creates a sandbox for each test.
- **Config Mocks**: `createTestConfig()` and `createMinimalConfig()`.
- **Shell Mocking**: `createMockShellRunner()` to intercept and verify shell commands.
- **SDK Mocking**: `createMockClient()` to simulate the OpenCode SDK environment.
- **Event Mocks**: `createMockEvent` and `mockEvents` factory for plugin events.

### Coverage Requirements

We maintain a high standard for code coverage.
- **Minimum Requirement**: 70% line coverage for all new code.
- **Ideal**: 90%+ function coverage.
- PRs that significantly decrease overall coverage may be rejected or require additional tests.

## Mock Usage Guidelines

Avoid using real system calls or external APIs in unit and E2E tests.

### Shell Commands
Instead of using the real `$` shell runner, use `createMockShellRunner()`:
```javascript
import { createMockShellRunner } from '../setup.js';

const mockShell = createMockShellRunner({
  handler: (command) => {
    if (command.includes('osascript')) return { stdout: Buffer.from('iTerm2') };
    return { exitCode: 0 };
  }
});

// Use it in your tests
await mockShell`echo "hello"`;
expect(mockShell.getCallCount()).toBe(1);
```

### OpenCode Client
Use `createMockClient()` to verify interactions with the OpenCode TUI, sessions, and permissions:
```javascript
import { createMockClient } from '../setup.js';

const client = createMockClient();
await client.tui.showToast({ body: { message: 'Hello' } });
expect(client.tui.getToastCalls()[0].message).toBe('Hello');
```

## Integration Testing (Credentials)

If you need to test real cloud APIs (ElevenLabs, OpenAI, etc.):
1. Copy `tests/.env.example` to `tests/.env.local`.
2. Fill in your real API keys.
3. Run `bun test tests/integration/`.

**NEVER** commit `tests/.env.local` to the repository. It is included in `.gitignore` by default.

## Coding Standards

- Use **ESM** (ECMAScript Modules) syntax (`import`/`export`).
- Follow the existing code style (use 2 spaces for indentation).
- Add JSDoc comments for all new functions and modules.
- Ensure `bun run typecheck` (if available) or basic linting passes.

## Pull Request Process

1. Create a new branch for your feature or bug fix.
2. Implement your changes and add tests.
3. Verify all tests pass locally (`bun test`).
4. Ensure your changes follow the existing architecture patterns.
5. Submit a PR with a clear description of what changed and why.

Thank you for contributing!
