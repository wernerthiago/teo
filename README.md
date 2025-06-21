# TEO - Path-Based Test Selection

## 🎯 **Quick Start**

```bash
# Install dependencies
npm install

# Run analysis
npx teo analyze --base main --head HEAD --output paths

# Execute selected tests with Playwright
npx playwright test $(npx teo analyze --output paths)
```

## 📁 **Project Structure**

```
teo-js/
├── src/
│   ├── analyzers/          # Git diff and AI analysis
│   ├── mappers/            # Feature detection and mapping
│   ├── providers/          # AI provider integrations
│   ├── integrations/       # Playwright integration
│   ├── core/              # Core engine and configuration
│   └── cli/               # Command-line interface
├── examples/
│   └── demo-project/      # Complete working example
└── docs/                  # Comprehensive documentation
```

## 🎭 **Playwright Integration Patterns**

### **Pattern 1: Simple Path Execution**
```bash
TESTS=$(teo analyze --output paths)
npx playwright test $TESTS
```

### **Pattern 2: Conditional Execution**
```bash
TESTS=$(teo analyze --output paths)
if [ -n "$TESTS" ]; then
  npx playwright test $TESTS
else
  npx playwright test  # Run all tests
fi
```

### **Pattern 3: Feature-Based Execution**
```bash
ANALYSIS=$(teo analyze --output json)
FEATURES=$(echo "$ANALYSIS" | jq -r '.selectedTests[].feature' | sort -u)

for FEATURE in $FEATURES; do
  FEATURE_TESTS=$(echo "$ANALYSIS" | jq -r ".selectedTests[] | select(.feature==\"$FEATURE\") | .path")
  npx playwright test $FEATURE_TESTS --project=$FEATURE
done
```

## 🔧 **Configuration**

Create `teo-config.yaml`:

```yaml
project_name: my-project
repo_path: . # Used if remote_repository_url is not set

git:
  default_branch: main
  # remote_repository_url: 'https://github.com/your-org/your-repo.git' # Uncomment to use a remote repo
  ignore_patterns:
    - "*.log"
    - "node_modules/**"

feature_detection:
  strategies:
    - type: "folder_based"
      weight: 0.3
      enabled: true
    - type: "file_based" 
      weight: 0.4
      enabled: true
    - type: "annotation_based"
      weight: 0.2
      enabled: true
    - type: "ast_based"
      weight: 0.1
      enabled: false

integrations:
  playwright:
    framework: playwright
    test_dir: tests
    test_patterns:
      - '**/*.spec.js'
      - '**/*.spec.ts'

features:
  authentication:
    source_patterns:
      - 'src/auth/**'
      - '**/auth-service.js'
    test_patterns:
      - 'tests/auth/**'
      - 'tests/**/auth*.spec.js'
    confidence: 0.9

ai_providers:
  primary:
    type: "azure-openai"
    deployment_name: "tc-gpt-4.1"
    api_key: "${AZURE_OPENAI_API_KEY}"
    endpoint: "${AZURE_OPENAI_ENDPOINT}"
    api_version: "${AZURE_OPENAI_VERSION}"
    timeout: 30000
    max_tokens: 2000
    temperature: 0.1
    model: ""
```

The `git` section allows for specifying local repository paths or even a `remote_repository_url` for TEO to clone and analyze. For detailed information on Git configuration, see the [Complete Guide](docs/complete-guide.md#git-configuration).

> Note that in the example above it is set for Azure OpenAI, but TEO supports others providers.

## 📊 **Performance Results**

| Metric | Before TEO | After TEO | Improvement |
|--------|------------|-----------|-------------|
| **Test Execution Time** | 15-45 min | 3-12 min | **67-80% faster** |
| **CI/CD Cost** | High | Low | **60-80% savings** |
| **Developer Feedback** | Slow | Fast | **4x faster** |
| **Resource Usage** | 100% | 20-33% | **67-80% reduction** |

## 🎯 **Demo Project**

The `examples/demo-project/` contains a complete working example:

```bash
cd examples/demo-project

# Run the interactive demo
./demo-v2.sh

# Or test manually
node ../../src/cli/index.js analyze --base HEAD~1 --head HEAD --output paths
```

## 🔄 **CI/CD Integration**

### **GitHub Actions**
```yaml
- name: Smart Test Selection
  run: |
    TESTS=$(teo analyze --base origin/main --head HEAD --output paths)
    npx playwright test $TESTS
```

### **Jenkins**
```groovy
script {
    def tests = sh(script: 'teo analyze --output paths', returnStdout: true).trim()
    sh "npx playwright test ${tests}"
}
```

## 📚 **Documentation**

- **[Complete Guide](docs/complete-guide.md)**: Comprehensive documentation
- **[Playwright Integration Research](docs/playwright-integration-research.md)**: Technical details
- **[Demo Project README](examples/demo-project/README.md)**: Working example

## 🎊 **Key Benefits**

1. **🚀 Performance**: 67-80% faster test execution
2. **🔧 Flexibility**: Use Playwright's full capabilities
3. **💰 Cost Savings**: Significant CI/CD resource reduction
4. **🎯 Accuracy**: Intelligent feature detection
5. **📈 Scalability**: Works with projects of any size
6. **🔄 Integration**: Easy CI/CD pipeline integration

## 🛠️ **Commands**

```bash
# Analyze changes and output paths
teo analyze --base main --head HEAD --output paths

# Get detailed JSON analysis
teo analyze --output json

# Generate Playwright command
teo analyze --output command

# Validate configuration
teo validate --config teo-config.yaml

# Initialize new configuration
teo init --config teo-config.yaml
```

## 🎭 **Ready to Transform Your Testing?**

TEO represents an intelligent way to execute the test automation. By focusing on test selection rather than execution, it provides the perfect balance of intelligence and flexibility.

**Start your journey to 67-80% faster testing today!** 🚀