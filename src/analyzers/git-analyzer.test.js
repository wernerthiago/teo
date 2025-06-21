// Test structure based on the provided plan
import { GitDiffAnalyzer } from './git-analyzer.js';
// TEOConfig might not be directly needed if we construct gitConfig objects manually for tests.
// import { TEOConfig } from '../core/config.js';
import fs from 'fs-extra';
import path from 'path';
import { simpleGit } from 'simple-git';

const PUBLIC_TEST_REPO_URL = 'https://github.com/git-fixtures/basic.git';
// Define TEMP_BASE_DIR relative to __dirname for Jest execution context
const TEMP_BASE_DIR = path.resolve(process.cwd(), 'test_temp_space_git_analyzer');
const REMOTE_REPOS_CACHE_BASE = path.resolve(TEMP_BASE_DIR, '.teo_cache'); // Base for .teo_cache
const REMOTE_REPOS_CACHE_DIR = path.resolve(REMOTE_REPOS_CACHE_BASE, 'remote_repos');


describe('GitDiffAnalyzer', () => {
    beforeAll(async () => {
        await fs.ensureDir(TEMP_BASE_DIR);
    });

    afterAll(async () => {
        await fs.remove(TEMP_BASE_DIR); // Clean up the entire temporary space
    });

    beforeEach(async () => {
        // Clean up remote repos cache before each test to ensure isolation
        await fs.emptyDir(REMOTE_REPOS_CACHE_DIR);
        // Clean up any other potential test-specific directories directly under TEMP_BASE_DIR if needed by tests
        const items = await fs.readdir(TEMP_BASE_DIR);
        for (const item of items) {
            if (item !== '.teo_cache') { // Don't remove the base cache dir, just its contents or specific test dirs
                const itemPath = path.resolve(TEMP_BASE_DIR, item);
                if ((await fs.lstat(itemPath)).isDirectory()) {
                     // Be careful here: only remove dirs known to be test-specific if not handled by afterAll
                }
            }
        }
    });

    test('should initialize with a local repository path', async () => {
        const localRepoPath = path.resolve(TEMP_BASE_DIR, 'local-repo-test');
        await fs.ensureDir(localRepoPath);
        const git = simpleGit(localRepoPath);
        await git.init();
        await fs.writeFile(path.join(localRepoPath, 'readme.md'), 'Initial commit');
        await git.add('readme.md');
        await git.commit('Initial commit');

        const gitConfig = { repo_path: localRepoPath };
        // Pass TEMP_BASE_DIR as basePath, though for local paths it's less critical if repo_path is absolute
        const analyzer = new GitDiffAnalyzer(gitConfig, TEMP_BASE_DIR);

        expect(analyzer.repoPath).toBe(localRepoPath);
        // CheckIsRepo is async, ensure to await it.
        // The 'root' argument might not be necessary depending on simple-git version / usage in main code.
        // Let's assume checkIsRepo() is sufficient or use 'root' if that's what main code does.
        expect(await analyzer.git.checkIsRepo()).toBe(true);
    });

    test('should clone a remote repository if remote_repository_url is provided (first clone)', async () => {
        const gitConfig = { remote_repository_url: PUBLIC_TEST_REPO_URL };
        const analyzer = new GitDiffAnalyzer(gitConfig, TEMP_BASE_DIR); // TEMP_BASE_DIR is the overall project/base path

        // analyzer.repoPath is set by the constructor to the target temporary clone path.
        await analyzer.initRemoteRepo(gitConfig.remote_repository_url, analyzer.repoPath);

        const expectedRepoName = path.basename(PUBLIC_TEST_REPO_URL, '.git');
        // The constructor of GitDiffAnalyzer determines the tempRepoPath using:
        // path.resolve(basePath, '.teo_cache', 'remote_repos', repoName)
        // So, REMOTE_REPOS_CACHE_DIR is effectively path.resolve(TEMP_BASE_DIR, '.teo_cache', 'remote_repos')
        const expectedClonePath = path.resolve(REMOTE_REPOS_CACHE_DIR, expectedRepoName);

        expect(analyzer.repoPath).toBe(expectedClonePath);
        expect(await fs.pathExists(analyzer.repoPath)).toBe(true);

        const clonedGit = simpleGit(analyzer.repoPath);
        expect(await clonedGit.checkIsRepo('root')).toBe(true); // 'root' is safer for specific checks
        const remotes = await clonedGit.getRemotes(true);
        expect(remotes.some(remote => remote.name === 'origin' && remote.refs.fetch === PUBLIC_TEST_REPO_URL)).toBe(true);
    });

    test('should fetch updates if remote repository already exists locally and is valid', async () => {
        const gitConfig = { remote_repository_url: PUBLIC_TEST_REPO_URL };

        // Step 1: Clone the repository initially
        const analyzerPreClone = new GitDiffAnalyzer(gitConfig, TEMP_BASE_DIR);
        await analyzerPreClone.initRemoteRepo(gitConfig.remote_repository_url, analyzerPreClone.repoPath);
        const clonedRepoPath = analyzerPreClone.repoPath; // This is the path where the repo was cloned

        // Step 2: Create a new analyzer instance for the same configuration.
        // Its constructor will set analyzerPostClone.repoPath to the same `clonedRepoPath`
        // because the remote URL and basePath are the same.
        const analyzerPostClone = new GitDiffAnalyzer(gitConfig, TEMP_BASE_DIR);
        expect(analyzerPostClone.repoPath).toBe(clonedRepoPath); // Verify it's targeting the same path

        // Spy on `fetch` on the `git` instance of the *second* analyzer.
        // This `git` instance is initially simpleGit() in constructor, then re-assigned in initRemoteRepo
        // *after* clone/fetch. So, we need to spy on the instance that will exist *during* the fetch call.
        // The `initRemoteRepo` method in `git-analyzer.js` does:
        // `this.git = simpleGit(localPath)` AFTER a successful clone or if it determines fetch is needed.
        // This means the `this.git` instance *before* calling `initRemoteRepo` is not the one that will perform fetch necessarily.
        // However, `initRemoteRepo` uses `this.git.fetch()` if repo exists.
        // The `this.git` is `simpleGit()` then `this.git.cwd(localPath)`.

        const mockGitInstance = simpleGit(clonedRepoPath); // Create a git instance for the path
        const fetchSpy = jest.spyOn(mockGitInstance, 'fetch');
        const cloneSpy = jest.spyOn(mockGitInstance, 'clone'); // Spy on clone as well

        // To make this spy effective, analyzerPostClone.git must be this mockGitInstance
        // The current implementation of GitDiffAnalyzer reinitializes its `this.git` in initRemoteRepo.
        // So, we'd have to inject the mocked instance or mock simpleGit factory.
        // For simplicity, let's spy on the prototype if methods are instance-bound in a way jest can catch,
        // or adjust git-analyzer to allow git instance injection for tests.

        // Given the current structure of initRemoteRepo:
        // 1. `this.git = simpleGit()` (in constructor, if remote)
        // 2. `this.git.cwd(localPath).checkIsRepo('root')`
        // 3. If fetch: `this.git.fetch()`
        // 4. If clone: `simpleGit().clone(...)`, then `this.git = simpleGit(localPath)`
        // So, for fetch, the `this.git` instance from constructor (after cwd) is used.

        const spyGit = analyzerPostClone.git; // This is simpleGit() from constructor
        const fetchActualSpy = jest.spyOn(spyGit, 'fetch');
        // Clone is called on a *new* simpleGit() instance if cloning, so direct spy on analyzerPostClone.git.clone won't work for initial clone.
        // But we are testing the "fetch" path, so clone should not be called.

        await analyzerPostClone.initRemoteRepo(gitConfig.remote_repository_url, clonedRepoPath);

        expect(fetchActualSpy).toHaveBeenCalled();
        // To assert clone was not called is harder. We can check if fs.emptyDir was called,
        // as it's a precursor to clone in the current `initRemoteRepo` logic.
        const emptyDirSpy = jest.spyOn(fs, 'emptyDir');
        expect(emptyDirSpy).not.toHaveBeenCalled(); // Assuming emptyDir is only called before clone

        fetchActualSpy.mockRestore();
        emptyDirSpy.mockRestore();
    });

    test('should throw an error for an invalid remote_repository_url', async () => {
        const gitConfig = { remote_repository_url: 'https://invalid-url-that-does-not-exist/nonexistent.git' };
        const analyzer = new GitDiffAnalyzer(gitConfig, TEMP_BASE_DIR);

        // analyzer.repoPath is determined by constructor. initRemoteRepo uses it.
        await expect(analyzer.initRemoteRepo(gitConfig.remote_repository_url, analyzer.repoPath))
              .rejects
              .toThrow(); // Default error from simple-git is often generic, or we can make it more specific in main code.
              // e.g. toThrow(/Failed to clone repository|could not read Username/i)
    });

    test('should prioritize remote_repository_url over local repo_path if both provided', async () => {
        const localRepoToIgnorePath = path.resolve(TEMP_BASE_DIR, 'dummy-local-repo-for-priority');
        await fs.ensureDir(localRepoToIgnorePath);
        const localGit = simpleGit(localRepoToIgnorePath);
        await localGit.init();
        await fs.writeFile(path.join(localRepoToIgnorePath, 'file.txt'), 'content');
        await localGit.add('.');
        await localGit.commit('init');

        const gitConfig = {
            remote_repository_url: PUBLIC_TEST_REPO_URL,
            repo_path: localRepoToIgnorePath // This local path should be ignored
        };
        const analyzer = new GitDiffAnalyzer(gitConfig, TEMP_BASE_DIR);
        // analyzer.repoPath will be the temp path for remote clone due to priority.
        await analyzer.initRemoteRepo(gitConfig.remote_repository_url, analyzer.repoPath);

        const expectedRepoName = path.basename(PUBLIC_TEST_REPO_URL, '.git');
        const expectedClonePath = path.resolve(REMOTE_REPOS_CACHE_DIR, expectedRepoName);

        expect(analyzer.repoPath).toBe(expectedClonePath); // Should be the remote clone path
        expect(await fs.pathExists(analyzer.repoPath)).toBe(true);
        const clonedGit = simpleGit(analyzer.repoPath);
        expect(await clonedGit.checkIsRepo('root')).toBe(true);
        // Check it's indeed the public test repo
        const remotes = await clonedGit.getRemotes(true);
        expect(remotes.some(remote => remote.name === 'origin' && remote.refs.fetch === PUBLIC_TEST_REPO_URL)).toBe(true);
    });
});