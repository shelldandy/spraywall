---
description: Analyze PR review feedback and create comprehensive action plan
---

Use `gh` to gather all review feedback for the current branch PR, then:

1. Find the PR number for the current branch
2. Collect all review comments, inline comments, and CI check status
   - **IMPORTANT**: Only include unresolved comments - skip any that are already marked as resolved
   - Check comment resolution status via GitHub API
3. Read all files mentioned in unresolved review comments to understand context
4. Analyze feedback and categorize by priority:
   - Critical: Blocking issues, bugs, broken functionality
   - Medium: Incomplete work, should-fix items
   - Low: Nice-to-haves, clarifications needed

The plan should be comprehensive enough to share with reviewers and provide clear, actionable steps to address all unresolved feedback. Resolved comments can be ignored as they've already been addressed.
