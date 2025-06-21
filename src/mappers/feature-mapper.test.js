import { FeatureMapper, MappingStrategy } from './feature-mapper.js';
// To test strategies directly, we need their actual implementations, not mocks of the whole class.
// We will mock their dependencies like 'glob' and 'fs'.
import {
    FolderBasedStrategy as ActualFolderBasedStrategy,
    FileBasedStrategy as ActualFileBasedStrategy,
    AnnotationBasedStrategy as ActualAnnotationBasedStrategy,
    ASTBasedStrategy as ActualASTBasedStrategy
} from './feature-mapper.js';

import TEOConfig from '../core/config.js'; // For creating mock config if needed
import path from 'path';

// --- Mocks ---
// Mock 'glob' module for all strategies
jest.mock('glob', () => ({
  glob: jest.fn().mockResolvedValue([]), // Default mock for async glob
}));
const { glob } = require('glob'); // Get the mocked async glob

// Mock 'fs' module for AnnotationBasedStrategy
jest.mock('fs', () => {
  const originalFs = jest.requireActual('fs');
  return {
    ...originalFs,
    promises: {
      ...originalFs.promises,
      readFile: jest.fn().mockResolvedValue(''), // Default mock for readFile
    },
  };
});
const fsPromises = require('fs').promises; // Get the mocked fs.promises


describe('FeatureMapper Core', () => {
  const mockRepoPath = '/mock/repo/feature_mapper_core';
  let mockTeoConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    // Create a TEOConfig instance with strategy configurations
    const rawConfig = {
      project_name: 'test-project',
      repo_path: mockRepoPath, // This is the FeatureMapper's base repoPath
      feature_detection: {
        strategies: [
          { type: MappingStrategy.FOLDER_BASED, enabled: true, weight: 0.5 },
          { type: MappingStrategy.FILE_BASED, enabled: true, weight: 0.5 },
          { type: MappingStrategy.ANNOTATION_BASED, enabled: true, weight: 0.5 },
          { type: MappingStrategy.AST_BASED, enabled: true, weight: 0.5 },
        ],
      },
      features: {}, // Existing feature mappings
    };
    mockTeoConfig = new TEOConfig(rawConfig);
    // Mock TEOConfig.get to return parts of rawConfig for simplicity in this test
    jest.spyOn(mockTeoConfig, 'get').mockImplementation((key, defaultValue) => {
        const keys = key.split('.');
        let value = rawConfig;
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else { return defaultValue; }
        }
        return value;
    });
  });

  test('should initialize strategies with its own repoPath', () => {
    // Spy on the constructors of the actual strategies
    const folderStrategySpy = jest.spyOn(require('./feature-mapper'), 'FolderBasedStrategy');
    const fileStrategySpy = jest.spyOn(require('./feature-mapper'), 'FileBasedStrategy');
    const annotationStrategySpy = jest.spyOn(require('./feature-mapper'), 'AnnotationBasedStrategy');
    const astStrategySpy = jest.spyOn(require('./feature-mapper'), 'ASTBasedStrategy');

    new FeatureMapper(mockRepoPath, mockTeoConfig.config); // TEOConfig.config is the raw config object

    expect(folderStrategySpy).toHaveBeenCalledWith(expect.anything(), mockRepoPath);
    expect(fileStrategySpy).toHaveBeenCalledWith(expect.anything(), mockRepoPath);
    expect(annotationStrategySpy).toHaveBeenCalledWith(expect.anything(), mockRepoPath);
    expect(astStrategySpy).toHaveBeenCalledWith(expect.anything(), mockRepoPath);
  });
});


// --- Strategy-Level Tests ---

describe('FolderBasedStrategy', () => {
  const mockRepoPath = '/mock/repo/folder_strategy';
  let strategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new ActualFolderBasedStrategy({ weight: 1.0, enabled: true }, mockRepoPath);
    // Setup glob mock for this strategy's tests
    glob.mockResolvedValue([
      path.join(mockRepoPath, 'tests', 'featureA', 'test1.js'),
      path.join(mockRepoPath, 'spec', 'featureA.spec.ts')
    ]);
  });

  test('findTestFiles should call glob with correct cwd, absolute, nodir and process paths to relative', async () => {
    const testFiles = await strategy.findTestFiles('featureA', path.join(mockRepoPath, 'src', 'featureA', 'file.js'));

    expect(glob).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      cwd: mockRepoPath,
      absolute: true,
      nodir: true,
    }));
    // Check if all returned paths are relative
    expect(testFiles).toEqual([
      path.join('tests', 'featureA', 'test1.js'),
      path.join('spec', 'featureA.spec.ts')
    ]);
  });
});


describe('FileBasedStrategy', () => {
  const mockRepoPath = '/mock/repo/file_strategy';
  let strategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new ActualFileBasedStrategy({ weight: 1.0, enabled: true }, mockRepoPath);
    glob.mockResolvedValue([
      path.join(mockRepoPath, 'tests', 'componentX.test.js')
    ]);
  });

  test('resolveTestPatterns should call glob with correct cwd, absolute, nodir and process paths to relative', async () => {
    const testFiles = await strategy.resolveTestPatterns(['tests/componentX*.test.js']);

    expect(glob).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      cwd: mockRepoPath,
      absolute: true,
      nodir: true,
    }));
    expect(testFiles).toEqual([path.join('tests', 'componentX.test.js')]);
  });
});


describe('AnnotationBasedStrategy', () => {
  const mockRepoPath = '/mock/repo/annotation_strategy';
  let strategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new ActualAnnotationBasedStrategy({ weight: 1.0, enabled: true }, mockRepoPath);
    glob.mockResolvedValue([path.join(mockRepoPath, 'tests', 'annotatedFeature.test.js')]);
    fsPromises.readFile.mockResolvedValue('@feature: annotatedFeature');
  });

  test('findTestFilesForFeature should call glob with correct cwd, absolute, nodir and process paths to relative', async () => {
    const testFiles = await strategy.findTestFilesForFeature('annotatedFeature');

    expect(glob).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      cwd: mockRepoPath,
      absolute: true,
      nodir: true,
    }));
    expect(testFiles).toEqual([path.join('tests', 'annotatedFeature.test.js')]);
  });

  test('readFileContent should call fs.promises.readFile with absolute path', async () => {
    const absoluteFilePath = path.join(mockRepoPath, 'src', 'someFile.js');
    await strategy.readFileContent(absoluteFilePath);
    expect(fsPromises.readFile).toHaveBeenCalledWith(absoluteFilePath, 'utf8');
  });
});


describe('ASTBasedStrategy', () => {
  const mockRepoPath = '/mock/repo/ast_strategy';
  let strategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new ActualASTBasedStrategy({ weight: 1.0, enabled: true }, mockRepoPath);
    glob.mockResolvedValue([path.join(mockRepoPath, 'tests', 'symbolTest.spec.js')]);
  });

  test('findTestsForSymbols should call glob with correct cwd, absolute, nodir and process paths to relative', async () => {
    const testFiles = await strategy.findTestsForSymbols(['mySymbol'], 'myFeature');

    expect(glob).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      cwd: mockRepoPath,
      absolute: true,
      nodir: true,
    }));
    expect(testFiles).toEqual([path.join('tests', 'symbolTest.spec.js')]);
  });
});
