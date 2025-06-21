import { TEOEngine } from './engine.js';
import { TEOConfig } from './config.js';
import { GitDiffAnalyzer } from '../analyzers/git-analyzer.js'; // Import to access the mock
import { FeatureMapper } from '../mappers/feature-mapper.js'; // Import to check constructor calls
import { TestOrchestrator } from '../integrations/test-orchestrator.js'; // Import to check constructor calls
import path from 'path';

// --- Mocks ---
// Mock GitDiffAnalyzer
const mockGitAnalyzerInstance = {
    initRemoteRepo: jest.fn().mockResolvedValue(undefined),
    validateRepository: jest.fn().mockResolvedValue({ valid: true }), // Simulate successful validation
    analyzeDiff: jest.fn().mockResolvedValue({
        changes: [{ filePath: 'file.js', changeType: 'modified' }],
        languagesAffected: new Set(['javascript']),
        summary: { totalFilesChanged: 1, totalLinesAdded: 10, totalLinesRemoved: 2}
    }),
    repoPath: './mock-repo-path' // Default mock path, can be overridden by constructor args
};
jest.mock('../analyzers/git-analyzer.js', () => {
    return {
        GitDiffAnalyzer: jest.fn().mockImplementation((gitConfig, basePath) => {
            // Allow repoPath to be influenced by constructor args for more realistic mocking if needed
            mockGitAnalyzerInstance.repoPath = gitConfig?.repo_path || path.join(basePath, '.teo_cache', 'remote_repos', gitConfig?.remote_repository_url ? path.basename(gitConfig.remote_repository_url, '.git') : 'mock-local');
            return mockGitAnalyzerInstance;
        })
    };
});

// Mock FeatureMapper
jest.mock('../mappers/feature-mapper.js', () => {
    return {
        FeatureMapper: jest.fn().mockImplementation(() => ({
            mapChangesToFeatures: jest.fn().mockResolvedValue([]),
        }))
    };
});

// Mock TestOrchestrator
jest.mock('../integrations/test-orchestrator.js', () => {
    return {
        TestOrchestrator: jest.fn().mockImplementation(() => ({
            selectTests: jest.fn().mockResolvedValue({ selectedTests: [], summary: {} }),
            generateOutput: jest.fn().mockReturnValue(''),
            validateAll: jest.fn().mockResolvedValue({}),
            getAvailableFrameworks: jest.fn().mockReturnValue(['playwright'])
        }))
    };
});

// Helper to create a basic TEOConfig instance
const createMockConfig = (gitSettings = {}) => {
    const rawConfig = {
        project_name: 'test-project',
        repo_path: '.', // Default base path
        git: gitSettings,
        ai_providers: { primary: { type: 'openai', model: 'gpt-4' } },
        // Add other necessary minimal config properties if TEOConfig validation requires them
    };
    // Use TEOConfig's own mechanisms if possible, otherwise a simple object mock
    const config = new TEOConfig(rawConfig);
    // Mock the get method to return parts of rawConfig
    jest.spyOn(config, 'get').mockImplementation((key, defaultValue) => {
        const keys = key.split('.');
        let value = rawConfig;
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else {
                return defaultValue;
            }
        }
        return value;
    });
    jest.spyOn(config, 'validate').mockReturnValue({ valid: true, errors: [] }); // Mock validation
    return config;
};


describe('TEOEngine', () => {
    let localConfig;
    let remoteConfig;

    beforeEach(() => {
        jest.clearAllMocks(); // Reset mocks for each test

        localConfig = createMockConfig({ repo_path: './local-test-repo' });
        remoteConfig = createMockConfig({ remote_repository_url: 'https://some.remote.git/repo.git' });
    });

    test('should successfully create with a local repository configuration', async () => {
        const engine = await TEOEngine.create(localConfig);

        expect(GitDiffAnalyzer).toHaveBeenCalledTimes(1);
        // Access the mock instance provided by the mock constructor
        const currentMockAnalyzerInstance = GitDiffAnalyzer.mock.results[0].value;
        expect(currentMockAnalyzerInstance.initRemoteRepo).not.toHaveBeenCalled();

        expect(engine).toBeInstanceOf(TEOEngine);
        expect(engine.gitAnalyzer).toBeDefined();
        expect(FeatureMapper).toHaveBeenCalledTimes(1);
        expect(TestOrchestrator).toHaveBeenCalledTimes(1);
        // Check if featureMapper and testOrchestrator were called with the correct repoPath from gitAnalyzer
        expect(FeatureMapper).toHaveBeenCalledWith(currentMockAnalyzerInstance.repoPath, localConfig.config);
        expect(TestOrchestrator).toHaveBeenCalledWith(localConfig.config, currentMockAnalyzerInstance.repoPath);
    });

    test('should successfully create with a remote repository configuration', async () => {
        const engine = await TEOEngine.create(remoteConfig);

        expect(GitDiffAnalyzer).toHaveBeenCalledTimes(1);
        const currentMockAnalyzerInstance = GitDiffAnalyzer.mock.results[0].value;
        expect(currentMockAnalyzerInstance.initRemoteRepo).toHaveBeenCalledTimes(1);
        expect(currentMockAnalyzerInstance.initRemoteRepo).toHaveBeenCalledWith('https://some.remote.git/repo.git', expect.any(String));

        expect(engine).toBeInstanceOf(TEOEngine);
        // Verify repoPath on the engine's analyzer instance reflects the remote setup
        const expectedRepoName = path.basename(remoteConfig.get('git.remote_repository_url'), '.git');
        const expectedRemotePathSuffix = path.join('.teo_cache', 'remote_repos', expectedRepoName);
        expect(engine.gitAnalyzer.repoPath).toContain(expectedRemotePathSuffix);
        expect(FeatureMapper).toHaveBeenCalledWith(engine.gitAnalyzer.repoPath, remoteConfig.config);
        expect(TestOrchestrator).toHaveBeenCalledWith(remoteConfig.config, engine.gitAnalyzer.repoPath);

    });

    test('TEOEngine.create should throw if initRemoteRepo fails', async () => {
        // Configure the mock initRemoteRepo for the *next* GitDiffAnalyzer instance to fail
        // This relies on mockImplementationOnce if GitDiffAnalyzer is called anew,
        // or modifying the shared mockGitAnalyzerInstance if it's reused.
        // Since our mock creates a new object for mockGitAnalyzerInstance properties on each call,
        // we need to ensure the mock for THIS specific test run is the one that rejects.

        GitDiffAnalyzer.mockImplementationOnce(() => ({
            ...mockGitAnalyzerInstance, // Spread default behavior
            initRemoteRepo: jest.fn().mockRejectedValue(new Error('Clone failed')),
             // Ensure repoPath is set as expected for remote config
            repoPath: path.join(remoteConfig.get('repo_path', '.'), '.teo_cache', 'remote_repos', path.basename(remoteConfig.get('git.remote_repository_url'), '.git'))
        }));

        await expect(TEOEngine.create(remoteConfig)).rejects.toThrow('Failed to initialize remote repository: Clone failed');
    });

    test('analyze method should call gitAnalyzer.analyzeDiff', async () => {
        const engine = await TEOEngine.create(localConfig);
        const currentMockAnalyzerInstance = GitDiffAnalyzer.mock.results[0].value;

        await engine.analyze('base-ref', 'head-ref');

        expect(currentMockAnalyzerInstance.analyzeDiff).toHaveBeenCalledTimes(1);
        expect(currentMockAnalyzerInstance.analyzeDiff).toHaveBeenCalledWith('base-ref', 'head-ref');
    });

    test('validate method should call gitAnalyzer.validateRepository', async () => {
        const engine = await TEOEngine.create(localConfig);
        const currentMockAnalyzerInstance = GitDiffAnalyzer.mock.results[0].value;

        // Mock config validation within TEOConfig for the validate method
        jest.spyOn(localConfig, 'validate').mockReturnValue({ valid: true, errors: [] });


        await engine.validate();

        expect(currentMockAnalyzerInstance.validateRepository).toHaveBeenCalledTimes(1);
    });
});

// Minimal path mock if not already globally available (e.g. in some test setups)
// const path = require('path'); // Not needed if using ES6 imports and path is standard
// jest.mock('path', () => ({ ...jest.requireActual('path') })); // If path itself needs mocking for some reason (unlikely here)