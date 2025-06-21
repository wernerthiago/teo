import { TestOrchestrator } from './test-orchestrator';
import { PlaywrightIntegration } from './playwright-integration'; // To mock it
import path from 'path'; // For path.join if needed, though not strictly for these tests

// Mock PlaywrightIntegration
// This mock will capture the config passed to PlaywrightIntegration's constructor
jest.mock('./playwright-integration', () => {
  return jest.fn().mockImplementation(config => ({
    discoverTests: jest.fn().mockResolvedValue([]),
    selectTests: jest.fn().mockResolvedValue({ selectedTests: [], summary: {} }),
    validate: jest.fn().mockResolvedValue({ valid: true }),
    generateOutput: jest.fn().mockReturnValue(''),
    // Store the received config for easy access in tests (not strictly necessary with .mock.calls[0][0])
    _constructorConfig: config,
  }));
});


describe('TestOrchestrator', () => {
  const MOCK_ACTUAL_REPO_PATH = '/abs/path/to/actual_repo';
  const MOCK_CONFIG_REPO_PATH = '/abs/path/to/config_repo';
  const MOCK_PROCESS_CWD = '/abs/path/to/cwd'; // Used as a fallback
  let originalProcessCwd;

  beforeEach(() => {
    jest.clearAllMocks();
    // Mock process.cwd() for predictable fallback testing
    originalProcessCwd = process.cwd;
    process.cwd = jest.fn().mockReturnValue(MOCK_PROCESS_CWD);
  });

  afterEach(() => {
    process.cwd = originalProcessCwd; // Restore original process.cwd
  });

  test('should initialize PlaywrightIntegration with actualRepoPath when provided', () => {
    // Minimal config object expected by TestOrchestrator
    const mockConfigObject = {
      integrations: {
        playwright: {
          testDir: 'tests-playwright' // Example Playwright specific config
        }
      }
    };
    new TestOrchestrator(mockConfigObject, MOCK_ACTUAL_REPO_PATH);

    expect(PlaywrightIntegration).toHaveBeenCalledTimes(1);
    // Access the arguments passed to the PlaywrightIntegration constructor
    const playwrightCallConfig = PlaywrightIntegration.mock.calls[0][0];
    expect(playwrightCallConfig.projectRoot).toBe(MOCK_ACTUAL_REPO_PATH);
    expect(playwrightCallConfig.testDir).toBe('tests-playwright'); // Ensure other configs are passed through
  });

  test('should use config.repo_path for PlaywrightIntegration if actualRepoPath is null', () => {
    const mockConfigObject = {
      integrations: { playwright: { testDir: 'tests' } },
      repo_path: MOCK_CONFIG_REPO_PATH // This is TEOConfig's main repo_path
    };
    new TestOrchestrator(mockConfigObject, null); // Pass null for actualRepoPath

    expect(PlaywrightIntegration).toHaveBeenCalledTimes(1);
    const playwrightCallConfig = PlaywrightIntegration.mock.calls[0][0];
    expect(playwrightCallConfig.projectRoot).toBe(MOCK_CONFIG_REPO_PATH);
  });

  test('should use config.repo_path for PlaywrightIntegration if actualRepoPath is undefined', () => {
    const mockConfigObject = {
      integrations: { playwright: { testDir: 'tests' } },
      repo_path: MOCK_CONFIG_REPO_PATH
    };
    // Pass undefined (by not passing the second argument) for actualRepoPath
    new TestOrchestrator(mockConfigObject);

    expect(PlaywrightIntegration).toHaveBeenCalledTimes(1);
    const playwrightCallConfig = PlaywrightIntegration.mock.calls[0][0];
    expect(playwrightCallConfig.projectRoot).toBe(MOCK_CONFIG_REPO_PATH);
  });

  test('should use process.cwd() if actualRepoPath and config.repo_path are not available', () => {
    const mockConfigObject = {
      integrations: { playwright: { testDir: 'tests' } }
      // No repo_path in config object itself
    };
    new TestOrchestrator(mockConfigObject, null); // Pass null for actualRepoPath

    expect(PlaywrightIntegration).toHaveBeenCalledTimes(1);
    const playwrightCallConfig = PlaywrightIntegration.mock.calls[0][0];
    expect(playwrightCallConfig.projectRoot).toBe(MOCK_PROCESS_CWD);
    // Verify process.cwd was the fallback used. It's called once by the TestOrchestrator constructor.
    expect(process.cwd).toHaveBeenCalledTimes(1);
  });

  test('should still initialize PlaywrightIntegration if integrations config is missing, using defaults', () => {
    // This test checks robustness if config.integrations or config.integrations.playwright is null/undefined
    const mockConfigObject = {
        // No 'integrations' key
    };
    new TestOrchestrator(mockConfigObject, MOCK_ACTUAL_REPO_PATH);

    // PlaywrightIntegration should *not* be called if config.integrations.playwright is missing
    // because the `initializeIntegrations` method checks `if (this.config.integrations?.playwright)`
    expect(PlaywrightIntegration).not.toHaveBeenCalled();
  });

   test('should initialize PlaywrightIntegration if integrations.playwright is present, even if empty', () => {
    const mockConfigObject = {
        integrations: { playwright: {} } // Empty playwright config
    };
    new TestOrchestrator(mockConfigObject, MOCK_ACTUAL_REPO_PATH);

    expect(PlaywrightIntegration).toHaveBeenCalledTimes(1);
    const playwrightCallConfig = PlaywrightIntegration.mock.calls[0][0];
    expect(playwrightCallConfig.projectRoot).toBe(MOCK_ACTUAL_REPO_PATH);
  });

});
