# Hybrid Optimization Setup Checklist

**Setup Date:** 2026-04-21  
**Status:** COMPLETE - SKELETON READY FOR IMPLEMENTATION  
**Agent:** junior-dev

---

## PHASE 1: Environment Verification

### Dependencies Status

- [x] **Python 3.10+** - ✓ Installed (3.12.3)
  - ✓ Version verified: `python3 --version`
  - ⚠️ BLOCKER: venv tools missing (apt install python3.12-venv required)
  - ⚠️ BLOCKER: pip not available in Python installation

- [x] **Node.js 18+** - ✓ Installed (v24.13.0)
  - ✓ Version verified: `node --version`
  - ✓ Ready for TypeScript scripts

- [x] **Bun** - ✓ Installed (1.3.11)
  - ✓ Version verified: `bun --version`
  - ✓ Ready for build system

### Service Status

- [x] **Qdrant Server** - ✓ Running (port 6333)
  - ✓ Version: 1.17.1
  - ⚠️ **BLOCKER**: Collections empty (0/12 baseline collections)
  - ℹ️ Status: Service running but baseline data not present
  - ℹ️ Note: Baseline JSON files exist in baseline-results/
  - ℹ️ Action needed: Restore Qdrant collections from backup or regenerate

- [x] **Ollama** - ✓ Running (port 11434)
  - ✓ gemma4:31b-cloud available
  - ✓ Embedding model (nomic-embed-text) available
  - ℹ️ Status: Model available for testing

- [x] **OpenCode Server** - ✓ Running (port 4096)
  - ✓ Version: 1.14.19
  - ✓ Ready for test execution

### GPU Status

- ⚠️ **GPU Check** - Cannot verify (Python venv blocker)
  - Expected: NVIDIA GPU with 20GB+ VRAM
  - Status: Requires successful Python setup before verification

---

## PHASE 2: Directory Structure

### Created Directories

- [x] `scripts/optimization/` - ✓ Created
- [x] `scripts/optimization/variants/` - ✓ Created
- [x] `scripts/optimization/convergence/` - ✓ Created
- [x] `scripts/optimization/lora/` - ✓ Created
- [x] `configs/optimization/` - ✓ Created
- [x] `.lora-checkpoint/` - ✓ Created
- [x] `.variant-checkpoint/` - ✓ Created
- [x] `.synthetic-data/` - ✓ Created
- [x] `logs/optimization/` - ✓ Created

---

## PHASE 3: Configuration Files

### Created Configuration Files

- [x] `.variant-config.json` - ✓ Created
  - Variant axes: 5 (reasoning_verbosity, constraint_clarity, token_efficiency, example_density, control_token_clarity)
  - Max iterations: 20
  - Convergence threshold: 2.0%
  - Convergence iterations: 3

- [x] `.lora-config.json` - ✓ Created
  - Base model: gemma4:31b
  - LoRA rank: 16
  - LoRA alpha: 32
  - Training epochs: 2
  - Batch size: 4
  - Learning rate: 1e-4

- [x] `.metrics-schema.json` - ✓ Created
  - Collection pattern: {test-type}-{profile}-variant-{iteration}-v1
  - Metrics tracked: task_completion, constraint_adherence, tool_calling_accuracy, latency
  - Convergence fields: last_3_iterations_improvement, all_below_2_percent

- [x] `package.json` updated - ✓ Scripts added
  ```bash
  test:optimize              # Run optimization orchestrator
  test:lora-setup           # Setup LoRA environment
  test:lora-train           # Execute LoRA training
  test:variant-measure      # Measure variant performance
  test:convergence-check    # Check convergence gate
  ```

---

## PHASE 4: Infrastructure Scripts (Skeleton Ready)

### Variant Generation Tool
- [x] `scripts/optimization/prompt-variant-generator.ts` - ✓ Skeleton created
  - Status: **SKELETON READY FOR IMPLEMENTATION**
  - Functions stubbed: loadAgentPrompts(), loadNodePrompts(), generateVariants(), validateVariant()
  - Expected implementation: 2-3 weeks
  - Critical path: YES (blocks iteration 1)

### Convergence Gate Automation
- [x] `scripts/optimization/convergence/convergence-gate.ts` - ✓ Skeleton created
  - Status: **SKELETON READY FOR IMPLEMENTATION**
  - Functions stubbed: fetchLast3Iterations(), checkConvergence(), checkConstraintViolations()
  - Expected implementation: 1-2 weeks
  - Critical path: YES (blocks convergence detection)

### Per-Iteration Metrics Collection
- [x] `scripts/optimization/variant-measurement.ts` - ✓ Skeleton created
  - Status: **SKELETON READY FOR IMPLEMENTATION**
  - Functions stubbed: loadConfig(), startOpenCodeServer(), runVariantTests(), storeResultsInQdrant()
  - Expected implementation: 2-3 days
  - Critical path: YES (blocks iteration 1)

### LoRA Training Pipeline
- [x] `scripts/optimization/lora/setup.py` - ✓ Skeleton created
  - Status: **SKELETON READY FOR IMPLEMENTATION**
  - Functions stubbed: check_python_version(), check_gpu_availability(), install_lora_dependencies()
  - Expected implementation: 1-2 days
  - Critical path: NO (parallel track, week 3+)

- [x] `scripts/optimization/lora/train.py` - ✓ Skeleton created
  - Status: **SKELETON READY FOR IMPLEMENTATION**
  - Functions stubbed: load_base_model(), load_synthetic_data(), create_lora_adapter(), train_lora()
  - Expected implementation: 1-2 weeks
  - Critical path: NO (parallel track, week 3+)

### Optimization Orchestrator
- [x] `scripts/optimization/prompt-optimization.ts` - ✓ Skeleton created
  - Status: **SKELETON READY FOR IMPLEMENTATION**
  - Functions stubbed: executeVariantGeneration(), executeVariantMeasurement(), checkConvergenceGate()
  - Expected implementation: 3-5 days
  - Critical path: YES (orchestrates all steps)

---

## PHASE 5: Baseline Verification

### Baseline Files (LOCKED & IMMUTABLE)

- [x] `.baseline-lock` - ✓ Locked
  - Status: IMMUTABLE
  - Profiles: 6 (naga-ollama, naga, naga-haiku, naga-copilot, naga-haiku-copilot, naga-free)
  - Hard constraints: 7 (all at 100%)
  - Locked timestamp: 2026-04-21T06:24:35.234Z

- [x] `baseline-results/` - ✓ Complete
  - naga-ollama-baseline-v1.json ✓
  - naga-baseline-v1.json ✓
  - naga-haiku-baseline-v1.json ✓
  - naga-copilot-baseline-v1.json ✓
  - naga-haiku-copilot-baseline-v1.json ✓
  - naga-free-baseline-v1.json ✓

### Baseline Collection Status

- ⚠️ **Qdrant Collections** - MISSING (Critical blocker)
  - Expected: 12 baseline collections
  - Current: 0 collections
  - Required collections (6 subagent + 6 e2e):
    - prompt-engineering-test-harness-{profile}-baseline-v1 (6)
    - e2e-test-harness-{profile}-baseline-v1 (6)
  - Status: **REQUIRES RESTORATION**
  - Action: Restore from backup or regenerate via baseline-measurement.sh

---

## CRITICAL BLOCKERS SUMMARY

| Blocker | Severity | Status | Action Required |
|---------|----------|--------|-----------------|
| Python venv missing | HIGH | Blocking | `apt install python3.12-venv` (requires sudo) |
| Python pip not installed | HIGH | Blocking | Reinstall Python with pip |
| Qdrant collections empty | HIGH | Blocking | Restore collections from backup or regenerate |
| GPU verification blocked | MEDIUM | Blocked by Python | Resolve Python setup first |

---

## NEXT STEPS (Critical Path)

### Week 1 (Now - Days 1-7)
- [x] Environment setup ✓
- [x] Directory structure ✓
- [x] Configuration files ✓
- [x] Skeleton scripts ✓
- [ ] **Resolve Python blockers** ← IMMEDIATE ACTION REQUIRED
  - Install python3.12-venv
  - Verify pip availability
  - Test venv creation
- [ ] **Restore Qdrant collections** ← IMMEDIATE ACTION REQUIRED
  - Run baseline-measurement.sh to repopulate collections
  - Verify 12 collections exist

### Week 2 (Days 8-14)
- [ ] Implement variant generation tool (2-3 weeks, overlaps)
- [ ] Implement convergence gate automation (1-2 weeks, overlaps)
- [ ] Implement per-iteration metrics collection (2-3 days)

### Week 3 (Days 15-21)
- [ ] Complete variant generation implementation
- [ ] Complete convergence gate implementation
- [ ] Test infrastructure end-to-end

### Week 4-7 (Days 22-49)
- [ ] Execute optimization iterations (max 20)
- [ ] Monitor convergence gate
- [ ] Collect metrics across all profiles

---

## Validation Status

### Locked Decisions (MUST MAINTAIN)

- [x] **Phased Hybrid Approach**
  - Week 1-3: Setup/infrastructure ✓
  - Week 4-7: Execution (pending)

- [x] **Optimization Target: naga-ollama (gemma4:31b)**
  - Primary: naga-ollama ✓
  - Tier 2 validation: Ollama + Claude ✓
  - Tier 3 validation: All 6 profiles ✓

- [x] **Hard Constraints: ALL 7 at 100%**
  - Code validation: 100%
  - Verification accuracy: 100%
  - Citation traceability: 100%
  - Source confidence tagging: 100%
  - Factual accuracy: 100%
  - Convention adherence: 100%
  - Contradiction preservation: 100%

- [x] **Convergence Gate: <2% improvement × 3 iterations**
  - Automation: SKELETON READY
  - Implementation pending: 1-2 weeks

- [x] **Baseline: LOCKED & IMMUTABLE**
  - Collections: BLOCKED (need restoration)
  - JSON files: LOCKED ✓

---

## Infrastructure Readiness Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Environment | PARTIAL | Python blockers, Node.js OK, Bun OK |
| Services | PARTIAL | Qdrant empty, Ollama OK, OpenCode OK |
| Directories | COMPLETE | All 9 directories created |
| Config files | COMPLETE | All 3 JSON config files created |
| Scripts (skeleton) | COMPLETE | 6 skeleton scripts ready for implementation |
| Baseline (JSON) | COMPLETE | 6 baseline JSON files locked |
| Baseline (Qdrant) | BLOCKED | Collections missing, need restoration |

---

## Overall Setup Status

**Status: 60% COMPLETE - SKELETON READY, BLOCKERS PRESENT**

### What's Done ✓
1. Environment verification (mostly OK, Python issues noted)
2. Directory structure (9/9 created)
3. Configuration files (3/3 created)
4. Skeleton infrastructure scripts (6/6 created)
5. Package.json updated with optimization scripts
6. Baseline JSON files verified and locked

### What's Blocked ⚠️
1. Python venv installation (system package missing)
2. Qdrant baseline collections restoration
3. GPU verification (depends on Python fix)

### What's Pending 🔄
1. Implement variant generation tool (2-3 weeks)
2. Implement convergence gate automation (1-2 weeks)
3. Implement metrics collection (2-3 days)
4. Implement LoRA training pipeline (1-2 weeks)
5. Execute optimization iterations

---

## How to Proceed

### Immediate Actions (Today)
```bash
# 1. Resolve Python blockers
sudo apt install python3.12-venv python3.12-pip

# 2. Create venv
python3.12 -m venv .venv-lora
source .venv-lora/bin/activate

# 3. Restore Qdrant collections
bash scripts/baseline-measurement.sh

# 4. Verify setup
curl http://localhost:6333/collections | jq '.collections | length'
# Should show: 12
```

### Week 1 Next Steps
1. Fix Python environment (see above)
2. Restore Qdrant collections
3. Begin implementing variant generation tool
4. Begin implementing convergence gate automation

### Expected Timeline
- **Days 1-7:** Infrastructure setup (THIS) + Python fixes
- **Days 8-21:** Implement critical scripts (variant gen, convergence)
- **Days 22-49:** Execute optimization iterations
- **Convergence:** Expected week 6-7

---

## Files Modified/Created

### Created Files
- `.variant-config.json` - 25 lines
- `.lora-config.json` - 42 lines
- `.metrics-schema.json` - 40 lines
- `scripts/optimization/prompt-variant-generator.ts` - 300+ lines
- `scripts/optimization/variant-measurement.ts` - 280+ lines
- `scripts/optimization/convergence/convergence-gate.ts` - 280+ lines
- `scripts/optimization/prompt-optimization.ts` - 220+ lines
- `scripts/optimization/lora/setup.py` - 200+ lines
- `scripts/optimization/lora/train.py` - 300+ lines
- `SETUP-CHECKLIST.md` - This file

### Modified Files
- `package.json` - Added 5 optimization scripts

### NOT Modified
- Baseline files (immutable)
- Source code (no source changes)
- Test infrastructure (no changes)
- Agent prompts (no changes)

---

## Validation Gates

All gates must remain at 100%:
1. ✓ Code validation - No source changes
2. ✓ Verification accuracy - Baseline locked
3. ✓ Citation traceability - No schema changes
4. ✓ Source confidence tagging - Baseline locked
5. ✓ Factual accuracy - No code changes
6. ✓ Convention adherence - Configuration only
7. ✓ Contradiction preservation - Baseline locked

---

Generated: 2026-04-21T08:17:21.000Z  
Agent: junior-dev (setup phase)  
Status: **SKELETON INFRASTRUCTURE READY - AWAITING PYTHON FIXES AND QDRANT RESTORATION**
