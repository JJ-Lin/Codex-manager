---
tracker:
  kind: local
workspace:
  root: ~/.codex-manager/workspaces
agent:
  max_concurrent_agents: 1
  max_turns: 20
codex:
  command: codex app-server
  model: gpt-5.5
  thread_sandbox: workspace-write
codex_manager:
  default_profile: local-cockpit
  profiles:
    local-cockpit:
      label: 本地可视化驾驶舱
      mode: local_cockpit
      max_turns: 1
      checklist:
        - 解析任务需求
        - 确认仓库、账号和工作区
        - 启动 Codex 执行
        - 跟踪执行事件和日志
        - 整理结果证据
        - 等待人工复核
        - 同步外部任务
        - 归档完成
    symphony-blackbox:
      label: Symphony 黑盒
      mode: symphony_blackbox
      max_turns: 20
      checklist:
        - 领取任务
        - 准备隔离工作区
        - 启动 Symphony agent
        - 等待 agent 执行
        - 等待 tracker / Human Review
        - 同步 tracker 结果
        - 释放运行锁并归档
---
你正在执行 Codex Manager 分派的任务 {{ issue.identifier }}。

Title: {{ issue.title }}

Body:
{{ issue.description }}

Source: {{ issue.url }}

Repository: {{ task.repo_url }}

Workflow profile: {{ workflow.profile }}

Operate inside the assigned workspace. Use the local repository state as the source of truth, run focused verification before final handoff, and stop at a reviewable handoff instead of silently declaring remote tracker state complete.
