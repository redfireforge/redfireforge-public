# Workflow Runner Guide

The Workflow Runner lets you run visual workflow graphs under load, testing complete multi-step processes with full topology support including conditions, forks, joins, loops, and delays.

## Getting Started

### 1. Navigate to Workflow Runner

From the main navigation:
1. Click **Harness** (🏋) in the activity bar
2. Click **Workflow Runner** tab in the sub-navigation

### 2. Select a Workflow

Choose a workflow from the dropdown. The picker shows:
- Workflow name
- Number of HTTP steps
- Step names preview (e.g., "Get User → Create Order → Confirm")

If no workflows exist, create one in the **Workflow Designer** first.

### 3. Configure Initial Variables

If the workflow has variables (e.g., `{{baseUrl}}`, `{{apiKey}}`), you can edit them before running:

| Variable | Default Value | Your Value |
|----------|---------------|------------|
| baseUrl | https://api.example.com | https://staging.api.com |
| apiKey | sk-test-xxx | sk-prod-xxx |

Variable history is saved per-workflow, so you can quickly restore previous configurations.

### 4. Configure Execution Settings

| Setting | Description | Default |
|---------|-------------|---------|
| **Iterations** | Total number of workflow runs | 10 |
| **Concurrency** | Simultaneous iterations | 1 |
| **Execution Mode** | Fixed iterations or load profile | Fixed |
| **Think Time** | Delay between steps (constant/random/none) | None |
| **Timeout** | Per-request timeout in seconds | 30 |
| **Retry Count** | Retries on failure | 0 |
| **Error Policy** | continue, stop-first, stop-threshold | continue |

### 5. Run the Workflow

Click **▶ Run Workflow** to start. You'll see:
- Live progress bar
- Current iteration count
- Real-time TPS and average response time
- Error rate

### 6. View Results

After completion, click **View Results** or navigate to **Results** tab. Workflow runs are marked with ⚡ and can be filtered using the **Workflow Runs** tab.

---

## Understanding Iterations

Each **iteration** is one complete execution of the workflow graph:

```
Iteration #1: [Start] → [Get User] → [Create Order] → [End]  ✅ 250ms
Iteration #2: [Start] → [Get User] → [Create Order] → [End]  ✅ 280ms
Iteration #3: [Start] → [Get User] → [Create Order] → [End]  ❌ 450ms (step 2 failed)
...
```

### Isolation

Each iteration gets its own variable context. Variables extracted in iteration #1 do not affect iteration #2.

### Concurrency

With concurrency > 1, multiple iterations run in parallel:

```
Concurrency: 3

Time →
Iter #1: ████████░░░░░░░░
Iter #2: ░░████████░░░░░░
Iter #3: ░░░░████████░░░░
Iter #4: ████████░░░░░░░░  (starts after #1 finishes)
```

---

## Results Interpretation

### Iteration Performance Chart

A bar chart showing each iteration:
- **X-axis:** Iteration number
- **Y-axis:** Total duration (ms)
- **Green bars:** Passed iterations
- **Red bars:** Failed iterations
- **Yellow line:** Average duration

This helps identify:
- Outlier iterations (spikes)
- Performance degradation over time
- Failure patterns

### Per-Step Metrics Table

| Step | Count | Pass % | Avg | p50 | p95 | Min | Max |
|------|-------|--------|-----|-----|-----|-----|-----|
| Get User | 100 | 100% | 45ms | 42ms | 80ms | 30ms | 120ms |
| Create Order | 100 | 98% | 120ms | 110ms | 200ms | 80ms | 350ms |
| Confirm | 100 | 100% | 25ms | 22ms | 40ms | 15ms | 60ms |

This helps identify:
- Which step is the bottleneck (highest avg/p95)
- Which step has failures
- Response time distribution per step

### Per-Iteration Detail

Expandable list showing each iteration's results:

```
▶ Iteration #1  ✅  250ms  (3/3 passed)
▶ Iteration #2  ✅  280ms  (3/3 passed)
▼ Iteration #3  ❌  450ms  (2/3 passed)
   GET  Get User      200  45ms  ✓
   POST Create Order  500  350ms ✗
   GET  Confirm       —    —     (skipped)
```

Click on a result row to see full request/response details.

---

## Execution Modes

### Fixed Iterations (Default)

Run exactly N iterations:

```
Iterations: 100
Concurrency: 5

→ Runs 100 iterations total, 5 at a time
→ Finishes when all 100 complete
```

### Load Profile

Run for a duration with configurable patterns:

**Sustained:**
```
Duration: 60s
Concurrency: 10

→ Maintains 10 concurrent iterations for 60 seconds
→ Total iterations depends on workflow duration
```

**Ramp-Up:**
```
Duration: 120s
Max Concurrency: 20
Ramp-Up: 30s

→ Starts at 1, reaches 20 by 30s
→ Maintains 20 for remaining 90s
```

**Spike:**
```
Duration: 120s
Base Concurrency: 5
Spike: 50 at 60s for 10s

→ Normal load at 5, spikes to 50 between 60-70s
```

---

## Working with Variables

### Workflow Default Variables

Set in the Workflow Designer's **Workflow Variables** panel:

```yaml
baseUrl: https://api.example.com
apiKey: sk-test-xxx
defaultTimeout: 5000
```

### Override at Run Time

In Workflow Runner, edit any variable before running. Overrides apply only to this run and don't modify the workflow definition.

### Variable History

The runner remembers your last 10 variable configurations per workflow:

```
📋 Variable History
├── 2 min ago: baseUrl=https://staging.api.com
├── 1 hour ago: baseUrl=https://dev.api.com, apiKey=sk-dev-xxx
└── Yesterday: baseUrl=https://prod.api.com
```

Click to restore a previous configuration.

### Variable Extraction in Workflows

Variables extracted in one step are available in subsequent steps within the same iteration:

```
[Get User] → Extract: userId from response.id
     ↓
[Create Order] → Body: {"userId": "{{userId}}"}
     ↓
[Get Order] → URL: /orders/{{orderId}}
```

---

## Error Handling

### Error Policies

| Policy | Behavior |
|--------|----------|
| **continue** | Keep running all iterations, collect all results |
| **stop-first** | Stop immediately on first failure |
| **stop-threshold** | Stop when error count or rate exceeds threshold |

### Threshold Configuration

```
Error Policy: stop-threshold
Max Errors: 10        ← Stop after 10 failed requests
Max Error Rate: 5%    ← Stop if error rate exceeds 5%
```

### Retry Configuration

```
Retry Count: 3
Retry Delay: 1000ms

→ On failure, retry up to 3 times with 1s delay
→ Only final attempt's result is recorded
```

---

## Tips & Best Practices

### Start Small

Begin with low iterations and concurrency to validate the workflow works:
```
First run: 5 iterations, 1 concurrency
Scale up: 50 iterations, 5 concurrency
Full load: 500 iterations, 20 concurrency
```

### Monitor the Target System

High concurrency can overwhelm your API. Watch for:
- Increasing response times
- Growing error rates
- Target system resource usage

### Use Think Time for Realism

Real users don't hammer APIs instantly. Add think time:
```
Think Time: Random 500-2000ms

→ Simulates user reading/thinking between steps
```

### Check Step-Level Metrics

If overall performance degrades, check per-step metrics to find the bottleneck:
- Database-heavy endpoints often have higher p95
- External API calls may have high variance
- Auth endpoints may have rate limits

### Compare Runs

Use the baseline comparison feature to track performance over time:
1. Set a run as baseline
2. Run again after code changes
3. Compare metrics side-by-side

---

## CorrelationWait in Load Tests

Workflows with **CorrelationWait** nodes (which pause for external webhook callbacks) need special handling during load tests. You can't realistically coordinate thousands of external webhooks, so the Workflow Runner provides a **CorrelationWait Behavior** configuration section.

### CorrelationWait Behavior Section

When you select a workflow that contains CorrelationWait nodes, a new configuration section appears in the Workflow Runner:

| Mode | Behavior | Use Case |
|------|----------|----------|
| **Auto-Resume (Skip Wait)** | Immediately inject mock payload, continue | CI/smoke tests, high-throughput load tests (default) |
| **Synthetic Inject (Delayed)** | Wait configurable delay + jitter, then inject | Simulate realistic async timing |
| **Wait for Real Webhook** | Actually waits for external callback | Production-like testing with real integrations (not recommended for load tests) |

### Auto-Resume Mode (Recommended for Load Tests)

Best for high-throughput load testing where you want to measure HTTP performance without waiting for external systems:

1. Go to **Workflow Runner**
2. Select a workflow with CorrelationWait nodes
3. In the **CorrelationWait Behavior** section, select "Auto-Resume (Skip Wait)"
4. Configure the **Mock Webhook Response** (see below)
5. Run the workflow

#### Mock Webhook Response Configuration

The UI shows a simplified configuration for each CorrelationWait node:

- **Dynamic fields** (like `paymentStatus`, `status`, `state`) — editable input fields to configure the test scenario
- **Mock Payload preview** — read-only JSON showing the complete payload that will be injected

Example:
```
Wait for Payment Callback

paymentStatus    [completed                    ]
💡 Change this value to test different scenarios (e.g., "completed", "failed", "pending")

Mock Payload:
{
  "paymentId": "{{correlationId}}",
  "paymentStatus": "completed",
  "transactionId": "sample_transactionId",
  "processedAt": "sample_processedAt"
}
```

**Important:** All iterations use the same mock response values. The `{{correlationId}}` placeholder is automatically replaced with the actual correlation ID at runtime.

### Synthetic Inject Mode

Simulates more realistic timing by using a background **Synthetic Event Injector**:

1. Select "Synthetic Inject (Delayed)" mode
2. Set **Delay (ms)**: Base wait time (e.g., 2000ms)
3. Set **Jitter (±ms)**: Random variance (e.g., 500ms)
4. Configure dynamic fields (same as Auto-Resume)

**How it works:**
- Each workflow iteration pauses at the CorrelationWait node and registers with the correlation store
- A background "Synthetic Event Injector" monitors the store
- After the configured delay (+ jitter), the injector fires a synthetic resume with the mock payload
- The workflow continues as if a real webhook was received

This tests the full pause/resume flow while simulating realistic async timing — more production-like than Auto-Resume.

### Why is Configuration in the Runner?

This design separates workflow logic from test configuration:
- The same workflow can be tested with different behaviors without modifying the workflow definition
- Quick Test always waits for real webhooks (for debugging)
- Workflow Runner uses your configured behavior (for load testing)

### Important: Quick Test Behavior

**Quick Test always waits for real webhooks**, regardless of any configuration. This is intentional — Quick Test is for debugging and verifying that your actual integration works.

To test with Auto-Resume:
- ❌ Quick Test → always waits for real webhook
- ✅ Workflow Runner → uses your configured CorrelationWait Behavior

See [Workflow Correlation Guide](./workflow-correlation-guide.md) for more details on CorrelationWait configuration.

---

## Accessing from Workflow Designer

While editing a workflow in the Workflow Designer, click **Run in Harness** in the toolbar to:
1. Navigate directly to Workflow Runner
2. Pre-select the current workflow
3. Initialize variables from the workflow defaults

This provides a quick path from design → test.

---

## CLI Usage

Run workflows from the command line for CI/CD integration:

```bash
# Basic workflow test
redfireforge workflow my-workflow.yaml --iterations 100 --concurrency 10

# With variable overrides
redfireforge workflow my-workflow.yaml -i 50 -c 5 \
  --var baseUrl=https://staging.api.com \
  --var apiKey=sk-test-xxx

# With reporters
redfireforge workflow my-workflow.yaml -i 100 \
  --junit results.xml \
  --markdown results.md \
  --fail-threshold 5

# Machine-readable summary on stdout, for a CI gate
redfireforge workflow my-workflow.yaml -i 100 --output json | jq '.failed'
```

Workflow JSON reports one result **per iteration** — matching `--output junit`,
so both formats agree on `total`. An iteration fails if any of its steps failed,
and the steps are preserved under `steps`:

```json
{
  "name": "Iteration 1",
  "status": "fail",
  "durationMs": 56,
  "error": "Create Order: (http): expected 2xx, got HTTP 500",
  "steps": [
    { "name": "Login", "status": "pass", "durationMs": 54, "error": null },
    { "name": "Create Order", "status": "fail", "durationMs": 2, "error": "(http): expected 2xx, got HTTP 500" }
  ]
}
```

See [CLI Reference](./cli-reference.md) for full documentation.
