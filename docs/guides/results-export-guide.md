# Results Export Guide

Export test results in multiple formats — JSON, CSV, Markdown, and JUnit XML for reporting and CI integration.

## Overview

Export results for:
- Sharing with stakeholders
- Archival and compliance
- CI/CD integration
- Custom analysis

## Export Formats

### JSON

Full structured data for programmatic use.

```json
{
  "id": "run-2024-01-15-001",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "config": {
    "concurrency": 10,
    "iterations": 1000,
    "mode": "pool"
  },
  "summary": {
    "totalRequests": 1000,
    "passed": 985,
    "failed": 15,
    "tps": 22.5,
    "avgResponseMs": 145,
    "p95ResponseMs": 280,
    "p99ResponseMs": 450,
    "errorRate": 1.5
  },
  "results": [
    {
      "testName": "Create User",
      "url": "POST /users",
      "status": 201,
      "responseTimeMs": 145,
      "passed": true,
      "timestamp": "2024-01-15T10:30:01.234Z"
    }
  ]
}
```

**Use for:**
- Custom analysis tools
- Data pipelines
- Archival

### CSV

Flat table format for spreadsheets.

```csv
timestamp,test_name,method,url,status,response_ms,passed,error
2024-01-15T10:30:01,Create User,POST,/users,201,145,true,
2024-01-15T10:30:01,Get User,GET,/users/123,200,89,true,
2024-01-15T10:30:02,Delete User,DELETE,/users/456,404,52,false,Not found
```

**Use for:**
- Excel analysis
- Pivot tables
- Quick filtering

### Markdown

Human-readable report format.

```markdown
# Performance Test Report

**Date:** 2024-01-15 10:30:00
**Duration:** 44.5s
**Environment:** staging
**Microservice:** user-service

## Summary

| Metric | Value |
|--------|-------|
| Total Requests | 1000 |
| Passed | 985 (98.5%) |
| Failed | 15 (1.5%) |
| TPS | 22.5 |
| Avg Response | 145ms |
| P95 | 280ms |
| P99 | 450ms |

## Test Results

### Create User (POST /users)
- Requests: 334
- Pass Rate: 99.1%
- Avg Response: 165ms

### Get User (GET /users/{id})
- Requests: 333
- Pass Rate: 100%
- Avg Response: 89ms

### Delete User (DELETE /users/{id})
- Requests: 333
- Pass Rate: 96.4%
- Avg Response: 78ms
```

**Use for:**
- Documentation
- Email reports
- PR descriptions

### JUnit XML

Standard CI/CD test reporting format.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="Performance Tests" tests="1000" failures="15" time="44.5">
  <testsuite name="user-service" tests="1000" failures="15" time="44.5">
    <testcase name="Create User" classname="Users" time="0.145">
    </testcase>
    <testcase name="Get User" classname="Users" time="0.089">
    </testcase>
    <testcase name="Delete User" classname="Users" time="0.078">
      <failure message="404 Not Found">User not found</failure>
    </testcase>
  </testsuite>
</testsuites>
```

**Use for:**
- Jenkins
- GitHub Actions
- GitLab CI
- Any CI that supports JUnit format

## Exporting from UI

### Export Current Run

1. Go to **Results** tab
2. Select run from dropdown
3. Click **Export**
4. Choose format:
   - Export JSON
   - Export CSV
   - Export Markdown

### Export Settings

Configure what to include:

```
Export Options:
  ☑ Include summary metrics
  ☑ Include individual results
  ☑ Include failed requests only
  ☐ Include response bodies
  ☑ Include assertions
```

### Filename Format

Default: `{env}-{svc}-{timestamp}.{format}`

Example: `staging-user-service-2024-01-15-103000.json`

## Exporting from CLI

### JSON Output

```bash
redfireforge run tests.yaml --output results.json
```

### JSON to stdout (CI)

Pass the keyword `json` instead of a path to print a flat, CI-shaped report
straight to stdout. All other output is suppressed, so it can be piped directly:

```bash
redfireforge run tests.yaml --output json | jq '.failed'
```

```json
{
  "passed": 12,
  "failed": 2,
  "total": 14,
  "durationMs": 3421,
  "results": [
    { "name": "Get Users", "status": "pass", "durationMs": 123, "error": null },
    { "name": "Create Order", "status": "fail", "durationMs": 456, "error": "HTTP 500: internal error" }
  ]
}
```

This is a different, deliberately stable shape from the full `--output <path>`
report above — use the file when you need every per-request field, and stdout
when a pipeline just needs pass/fail counts. `--output junit` streams JUnit XML
the same way.

### JUnit XML

```bash
redfireforge run tests.yaml --junit results.xml
```

### Markdown

```bash
redfireforge run tests.yaml --markdown report.md
```

### Multiple Outputs

Export to multiple formats:

```bash
redfireforge run tests.yaml \
  --output results.json \
  --junit results.xml \
  --markdown report.md
```

## Customizing Exports

### Filtering Results

Export only specific data:

```bash
# Only failed requests
redfireforge run tests.yaml --output failed.json --filter failed

# Only specific tests
redfireforge run tests.yaml --output users.json --filter "Create User,Get User"
```

### Summary Only

Export just the summary:

```bash
redfireforge run tests.yaml --output summary.json --summary-only
```

### With Response Bodies

Include full response bodies (large!):

```bash
redfireforge run tests.yaml --output full.json --include-bodies
```

## CI/CD Integration

### GitHub Actions

```yaml
- name: Run Performance Tests
  run: |
    npx redfireforge run tests.yaml \
      --junit results.xml \
      --fail-threshold 5
      
- name: Publish Test Results
  uses: EnricoMi/publish-unit-test-result-action@v2
  if: always()
  with:
    files: results.xml
```

### Jenkins

```groovy
stage('Performance Tests') {
    steps {
        sh 'npx redfireforge run tests.yaml --junit results.xml'
    }
    post {
        always {
            junit 'results.xml'
        }
    }
}
```

### GitLab CI

```yaml
performance_test:
  script:
    - npx redfireforge run tests.yaml --junit results.xml
  artifacts:
    reports:
      junit: results.xml
```

## Data Analysis

### CSV in Excel

1. Export CSV
2. Open in Excel
3. Use pivot tables:
   - Rows: Test Name
   - Values: Avg Response Time, Count, Error Rate

### JSON with Python

```python
import json
import pandas as pd

with open('results.json') as f:
    data = json.load(f)

# Convert to DataFrame
df = pd.DataFrame(data['results'])

# Analyze
print(df.groupby('testName')['responseTimeMs'].describe())
```

### JSON with jq

```bash
# Extract summary
cat results.json | jq '.summary'

# Get failed requests
cat results.json | jq '.results[] | select(.passed == false)'

# Calculate average by test
cat results.json | jq 'group_by(.testName) | map({test: .[0].testName, avg: (map(.responseTimeMs) | add / length)})'
```

## Best Practices

### 1. Export Regularly

Archive results for:
- Trend analysis
- Compliance
- Debugging

### 2. Use JUnit for CI

Standard format understood by all CI systems.

### 3. Separate Summary and Details

- Summary for dashboards
- Details for debugging

### 4. Include Metadata

Ensure exports include:
- Timestamp
- Environment
- Configuration
- Git commit/version

### 5. Compress Large Exports

For full exports with bodies:
```bash
redfireforge run tests.yaml --output results.json
gzip results.json
```

## Export Size Considerations

| Content | Approximate Size |
|---------|------------------|
| Summary only | ~1 KB |
| 1000 results (no bodies) | ~100 KB |
| 1000 results (with bodies) | ~10 MB |

Tips for large exports:
- Use `--summary-only` when possible
- Exclude response bodies unless needed
- Compress with gzip

## Related Guides

- [Results Guide](./results-guide.md) — Results dashboard
- [Results Comparison Guide](./results-comparison-guide.md) — Comparing runs
- [CLI CI/CD Guide](./cli-ci-cd.md) — CI integration
