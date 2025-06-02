# 🤝 Contributing to Unified DGM-Codex

Thank you for your interest in contributing to Unified DGM-Codex! This document provides guidelines and information for contributors.

## 🌟 How to Contribute

### 🐛 Reporting Bugs

1. **Check existing issues** first to avoid duplicates
2. **Use the bug report template** when creating new issues
3. **Provide detailed information**:
   - Operating system and version
   - Node.js version
   - Steps to reproduce
   - Expected vs actual behavior
   - Error messages and stack traces

### 💡 Suggesting Features

1. **Check the roadmap** in the README to see if it's already planned
2. **Open a discussion** first for major features
3. **Use the feature request template**
4. **Explain the use case** and potential implementation

### 🔧 Code Contributions

#### Prerequisites

- Node.js 18+ or 20+
- Git
- Docker (for testing sandbox features)
- Redis (for caching tests)

#### Development Setup

```bash
# 1. Fork and clone the repository
git clone https://github.com/YOUR_USERNAME/Unified-DGM-Codex.git
cd Unified-DGM-Codex

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.example .env
# Add your API keys for testing

# 4. Run tests to ensure everything works
npm test

# 5. Start development mode
npm run dev
```

#### Development Workflow

1. **Create a feature branch**:
   ```bash
   git checkout -b feature/amazing-feature
   ```

2. **Make your changes** following our coding standards

3. **Test your changes**:
   ```bash
   npm run type-check  # TypeScript validation
   npm run lint        # Code linting
   npm run format      # Code formatting
   npm test           # Run test suite
   npm run build      # Ensure it builds
   ```

4. **Commit your changes**:
   ```bash
   git commit -m "feat: add amazing feature"
   ```

5. **Push and create a Pull Request**:
   ```bash
   git push origin feature/amazing-feature
   ```

## 📋 Coding Standards

### TypeScript Guidelines

- **Strict mode**: All code must pass TypeScript strict mode
- **Type safety**: Avoid `any` types, use proper interfaces
- **Naming conventions**:
  - Variables/functions: `camelCase`
  - Classes: `PascalCase`
  - Constants: `UPPER_SNAKE_CASE`
  - Files: `kebab-case.ts`

### Code Style

- **Prettier**: All code is automatically formatted
- **ESLint**: Follow the configured linting rules
- **Comments**: Use JSDoc for public APIs
- **Error handling**: Always handle errors gracefully

### Architecture Principles

- **Separation of concerns**: Each module has a single responsibility
- **Dependency injection**: Use constructor injection for dependencies
- **Interface segregation**: Keep interfaces focused and minimal
- **Error boundaries**: Implement proper error handling at module boundaries

## 🧪 Testing Guidelines

### Test Structure

```
tests/
├── unit/           # Unit tests for individual modules
├── integration/    # Integration tests for component interaction
└── benchmarks/     # Performance and benchmark tests
```

### Writing Tests

- **Test naming**: Describe what the test does
- **Arrange-Act-Assert**: Structure tests clearly
- **Mock external dependencies**: Use Jest mocks for APIs
- **Coverage**: Aim for >80% code coverage

### Example Test

```typescript
describe('LlamaScoutOptimized', () => {
  let llamaScout: LlamaScoutOptimized;
  
  beforeEach(() => {
    llamaScout = new LlamaScoutOptimized(mockConfig);
  });
  
  it('should analyze repository and build vector index', async () => {
    // Arrange
    const repoPath = '/test/repo';
    
    // Act
    await llamaScout.analyzeRepository(repoPath);
    
    // Assert
    expect(llamaScout.index.ntotal()).toBeGreaterThan(0);
  });
});
```

## 🏗️ Project Structure

### Core Components

- **`src/core/`**: Orchestration engine and main coordination
- **`src/models/`**: AI model wrappers and optimizations
- **`src/dgm/`**: Darwin Gödel Machine evolution engine
- **`src/cli/`**: Command-line interface
- **`src/sandbox/`**: Security and isolation layer
- **`src/utils/`**: Shared utilities and helpers

### Adding New Features

1. **Model Integration**: Add to `src/models/[model-name]/`
2. **CLI Commands**: Extend `src/cli/`
3. **Evolution Features**: Add to `src/dgm/`
4. **Utilities**: Add to `src/utils/`

## 🚀 Release Process

### Version Numbering

We follow [Semantic Versioning](https://semver.org/):
- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes (backward compatible)

### Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

feat: add new feature
fix: fix bug
docs: update documentation
style: formatting changes
refactor: code refactoring
test: add tests
chore: maintenance tasks
```

### Release Checklist

- [ ] All tests pass
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] Version bumped in package.json
- [ ] Tagged release created

## 🎯 Areas for Contribution

### High Priority

- **GPT 4.1 Integration**: Complete the code generation specialist
- **DGM Evolution Engine**: Implement self-improvement capabilities
- **CLI Interface**: Build the interactive command interface
- **Documentation**: Improve guides and API documentation

### Medium Priority

- **Performance Optimization**: Improve caching and indexing
- **Security Enhancements**: Strengthen sandbox isolation
- **Testing**: Increase test coverage and add benchmarks
- **Error Handling**: Improve error messages and recovery

### Good First Issues

- **Documentation improvements**
- **Type definition enhancements**
- **Unit test additions**
- **Code formatting and linting fixes**
- **Configuration improvements**

## 🆘 Getting Help

- **GitHub Discussions**: For questions and general discussion
- **GitHub Issues**: For bug reports and feature requests
- **Discord**: [Join our community](https://discord.gg/unified-dgm-codex)
- **Email**: artificialesque@example.com

## 📄 License

By contributing to Unified DGM-Codex, you agree that your contributions will be licensed under the MIT License.

## 🙏 Recognition

Contributors will be recognized in:
- **README.md**: Contributors section
- **CHANGELOG.md**: Release notes
- **GitHub**: Contributor graphs and statistics
 