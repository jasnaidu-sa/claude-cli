# UI/UX Improvements - Make Execution Dashboard Like Leon's

See full analysis document for details.

Key findings:
- Leon uses real-time SSE streaming to show every event
- We need to emit events in agent.py during streaming
- Add EventLog component to show tool use in real-time
- Replace 3-phase stepper with simple progress bar
- Add agent type badge (GENERATION vs IMPLEMENTATION)
