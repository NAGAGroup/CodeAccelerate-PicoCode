
# Optimization Modes

* subagent system prompts
* delegation node prompts
   * project-survey
   * web-research
   * project-analysis
   * project-setup
   * junior-dev-work-item
   * verify
   * junior-dev-triage
* E2E (headwrench system prompt optimization + planning node prompts + delibration node prompt which will be used to inform collaborate node prompt + kickoff node prompts)
   * planning DAG E2E (modified slightly so no question tool usage is necessary)
   * full deliberation phases E2E but only deliberation node + headwrench are optimized

# Scenarios

## CPP Greenfield Project

AGENTS.md file will provide the implicit instructions for the project (e.g. use pixi first with CPM fallback, pixi usage instructions, etc). This will ensure that AGENTS.md can be used to relax the constraint on perfect prompts  to agents. Essentially, is AGENTS.md being followed?

* junior-dev-work-item: adding and using  a pixi dependency, must compile and run.
* junior-dev-work-item: adding and using a CPM dependency, must compile and run.
* planning DAG E2E: purposefully challenging, complex plan request that requires incorporating all the common failure modes: pixi vs. CPM captured in the plan, branching, web search, triage/implement/verify/setup instructions, planning context captured in phases, etc. and of course, being E2E this will optimize headwrench's ability to follow DAGs without stopping

## CPP Greenfield Project that Has Been Modified To Implement Complex But Broken State

* verify: straightforward, verification should fail
* junior-dev-triage: when optimizing for junior-dev, it will be given a pretty poor triage prompt that stress tests the common failure mode of headwrench saying "fix the cmake build system" just because it was a cmake error, even tho there will be two things to fix: cmake issue + code issues. junior-dev will need to know that it shouldn't get tunnel vision on just fixing cmake

## Real-World CPP Project

* project-setup: add pixi support so the project can be built with pixi
* project-survey/analysis
* deliberation E2E: here E2E means a kickoff + the expanded deliberation phase, but only the kickoff + headwrench + deliberation node are optimized, the survey/web/analysis expanded nodes will use pre-optimized prompts and subagent system prompts

## Web Research

No specific project necessary, single scenario. Low risk since it already works well. In fact, basically junior-dev is the biggest risk with subagents, hence all the scenarios. Even tailwrench is pretty straightforward.

## Notes

* optimization order goes: subagents (all delegation scenarios, but no headwrench, just delegating non-ideal prompts straight to subagents for the scenario, subagents start with unoptimized single line system prompts) -> delegation node prompts for all scenarios for each subagent type (eval is on headwrench's delegation prompt quailty, headwrench has unoptimized, single line system prompt) -> planning DAG E2E (eval is on generated plan + headwrench ability to get through without stopping + headwrench's stored notes, headwrench system prompt + planning prompts are optimized all togheter) -> deliberation E2E (eval is on deliberation quality, headwrench's stored notes + headwrench's ability to get through without stopping or asking questions, headwrench system prompt is optimized but small changes only + deliberation prompt)
* this, from my experience so far, should be a complete training set that when optimized would allow the system to handle any scenario. and by using cpp projects it ensures my use case is for sure handled + it's one of the most challenging langauges with a very fragmented ecosystem meaning if it can optimize for cpp without introducing domain-specific langague, any other project should be fin
* i realized i forgot documentation, that's also fairly straightforward will come up with a scenario or two for author-documentation node prompt
