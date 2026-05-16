# Update 024: OpenAI Computer Tool

## Summary

- Added `operate_computer` to let the agent invoke OpenAI Responses API computer tool calls.
- Added a macOS adapter for screenshots, coordinate mapping, clicks, movement, scrolling, text input, keypresses and drag paths.
- Updated docs for the `gpt-5.5` computer tool path, local permissions and runtime boundaries.

## Details

- `lib/computer-use/openai-computer-use.ts` owns the Responses API loop: send task, receive `computer_call`, execute actions locally, then return `computer_call_output` with a `computer_screenshot`.
- `lib/computer-use/macos-adapter.ts` uses `screencapture` and a generated Swift helper to bridge model actions to macOS desktop events.
- `lib/tools.ts` exposes the loop as `operate_computer`, with a max step limit and narrow safety wording in the tool description.
- `lib/agent.ts` treats desktop operation as an active tool action and leaves verification pending after it runs.
- Settings keep a separate Computer use API key and model field; the key falls back to the OpenAI provider key when unset.

## Notes

- This is a local web app plus Node backend implementation, not Electron.
- Desktop control requires macOS Screen Recording and Accessibility permissions for the process running the backend.
- The tool should stop for login, payment, sensitive data, destructive confirmation or other user-confirmation boundaries.
