# RedfireForge Concepts Overview

Understand the core concepts and terminology used throughout RedfireForge.

## Overview

RedfireForge organizes API testing into a hierarchy of concepts. This guide explains each one and how they relate.

## Core Concepts

### Environments

An **Environment** represents a deployment target where your APIs run.

| Example | Description |
|---------|-------------|
| `test` | Test environment |
| `staging` | Pre-production staging |
| `prod` | Live production |

Environments let you run the same tests against different deployments without changing test definitions.

### Microservices

A **Microservice** is a service or API that you test.

| Example | Description |
|---------|-------------|
| `user-service` | User management API |
| `order-api` | Order processing service |
| `payment-gateway` | Payment processing |

Each microservice can have different base URLs per environment:

```
user-service:
  test:       https://test.api.example.com/users
  staging:    https://staging.api.example.com/users
  prod:       https://api.example.com/users
```

### Feature Groups

A **Feature Group** is a collection of related scenarios organized around a business feature.

```
Feature Group: User Management
├── Scenario: User Registration
├── Scenario: User Login
└── Scenario: User Profile
```

Feature Groups inherit authentication from global profiles or define their own.

### Scenarios

A **Scenario** represents a specific user journey or test case within a feature.

```
Scenario: User Registration
├── Test: Create User (POST /users)
├── Test: Verify Email (POST /users/verify)
└── Test: Complete Profile (PUT /users/profile)
```

Scenarios can define their own auth that tests within them inherit.

### Tests

A **Test** is a single HTTP request with optional validation.

Components of a test:
- **URL**: The endpoint to call
- **Method**: GET, POST, PUT, PATCH, DELETE
- **Headers**: HTTP headers to send
- **Body**: Request payload (for POST/PUT/PATCH)
- **Auth**: Authentication configuration
- **Assertions**: Validation rules for the response

### Workflows

A **Workflow** is a visual graph of connected steps representing a complex API flow.

```
[Start] → [Create User] → [Get Token] → [Verify] → [End]
                              ↓
                        [Send Email]
```

Workflows support:
- Conditional branching
- Parallel execution (Fork/Join)
- Loops and iterations
- Variable extraction and chaining

## Data Concepts

### Data Sources

A **Data Source** provides test data for parameterized testing.

```yaml
columns:
  - id: userId
  - id: email
rows:
  - { userId: "1", email: "john@example.com" }
  - { userId: "2", email: "jane@example.com" }
```

Tests using data sources run once per row.

### Shared Data Sources

**Shared Data Sources** are data sources that can be used across multiple tests. Edit once, update everywhere.

### Variables

**Variables** use `{{name}}` syntax and are replaced at runtime:

```
URL: https://api.example.com/users/{{userId}}
Header: Authorization: Bearer {{token}}
Body: {"name": "{{username}}"}
```

Variable sources:
- Data source columns
- Extracted from previous responses
- Environment variables
- Workflow context

## Authentication Concepts

### Auth Types

| Type | Use Case |
|------|----------|
| **None** | Public endpoints |
| **Basic** | Username/password authentication |
| **Bearer** | Token-based authentication |
| **API Key** | Header or query param API keys |
| **OAuth2** | Client credentials flow |
| **Digest** | HTTP digest authentication |

### Auth Inheritance

Auth flows down the hierarchy:

```
Global Auth Profile
    ↓ (inherited by)
Feature Group
    ↓ (inherited by)
Scenario
    ↓ (inherited by)
Test
```

Each level can override the inherited auth.

## Execution Concepts

### Execution Modes

| Mode | Description |
|------|-------------|
| **Sequential** | One request at a time, in order |
| **Batch** | N concurrent requests, wait for all, repeat |
| **Pool** | Maintain N concurrent requests, replace as they complete |
| **Load Profile** | Time-based execution with ramp patterns |
| **Workflow** | Execute a workflow graph |

### Concurrency

**Concurrency** is the number of parallel requests in flight simultaneously.

```
Concurrency: 10
Iterations: 100
Mode: Pool

→ 10 requests start
→ As each completes, a new one starts
→ Until 100 total iterations have been executed
```

### Iterations

**Iterations** is the number of times to repeat execution in a test run. For standard tests, each iteration runs each selected test once. For workflows, each iteration runs the entire workflow graph once.

```
Iterations: 50
Concurrency: 5

→ 5 instances run in parallel
→ Each completes its full execution
→ Until 50 total iterations complete
```

## Validation Concepts

### Validation Modes

| Mode | Description |
|------|-------------|
| **None** | No body validation |
| **Full** | Deep-compare entire response body |
| **Selective** | Validate specific JSON paths only |

### Assertions

**Assertions** are validation rules that run on every request:

| Type | Example |
|------|---------|
| **Status** | Status code is `200` |
| **JSONPath** | `$.name` equals `"John"` |
| **Numeric** | `$.count` > `0` |
| **Regex** | `$.email` matches `^.+@.+$` |
| **Header** | `Content-Type` contains `json` |
| **Response Time** | Response time < `500ms` |

### Extractions

**Extractions** capture values from responses for use in later requests:

```yaml
extractions:
  - name: userId
    source: body
    expression: $.data.id
  - name: authToken
    source: header
    expression: Authorization
```

## Results Concepts

### Test Run

A **Test Run** is a complete execution of tests with all results and metrics.

### Metrics

| Metric | Description |
|--------|-------------|
| **TPS** | Requests per second |
| **Avg Response** | Mean response time |
| **P95 / P99** | 95th/99th percentile response times |
| **Error Rate** | Percentage of failed requests |
| **Min / Max** | Fastest and slowest response |

### Pass/Fail

A request **passes** if:
1. HTTP status indicates success (or matches expected status)
2. All assertions pass
3. No timeout occurred

## Visual Diagram

```
                          ┌─────────────────────────────┐
                          │    Global Auth Profiles     │
                          └──────────────┬──────────────┘
                                         │ inherits
                          ┌──────────────▼──────────────┐
                          │       Feature Groups        │
                          │  ┌─────────────────────┐    │
                          │  │  Scenarios (S / P)  │    │
                          │  │  ┌───────────────┐  │    │
                          │  │  │     Tests     │  │    │
                          │  │  │ (with Data)   │  │    │
                          │  │  └───────────────┘  │    │
                          │  └─────────────────────┘    │
                          └──────────────┬──────────────┘
                                         │ runs in
                    ┌────────────────────┬┴────────────────────┐
                    ▼                    ▼                     ▼
           ┌──────────────┐   ┌──────────────────┐   ┌──────────────┐
           │  Test Runner │   │  Parameterized   │   │   Workflow   │
           │  (Standard)  │   │     Runner       │   │    Runner    │
           │  Iterations  │   │   Iterations     │   │  Iterations  │
           └──────┬───────┘   └────────┬─────────┘   └──────┬───────┘
                  └────────────────────┼──────────────────────┘
                                         │ produces
                          ┌──────────────▼──────────────┐
                          │         Results             │
                          │  - Metrics                  │
                          │  - Pass/Fail status         │
                          │  - Response details         │
                          └─────────────────────────────┘
```

## Related Guides

- [Getting Started](./getting-started.md) — Quick start tutorial
- [Environments Guide](./environments-guide.md) — Configure environments
- [Scenarios Guide](./scenarios-guide.md) — Organize tests
- [Test Runner Guide](./test-runner-guide.md) — Run performance tests
- [Workflow Designer Guide](./workflow-designer-guide.md) — Build workflows
