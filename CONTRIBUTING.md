# Contributing to Foundry Local Explorer

Thanks for helping improve Foundry Local Explorer. This project is a proof of concept, so focused contributions that make the app more useful, reliable, or approachable are especially welcome.

## Before You Start

For a small fix, feel free to open a pull request directly. For a larger feature or a change to the app's architecture, open an issue first so the approach and scope can be discussed before substantial work begins.

Please check existing issues and pull requests to avoid duplicating work. When proposing a feature, describe the user problem, the intended behavior, and any platform or hardware requirements.

## Development Setup

Follow the [Project Setup](README.md#project-setup) instructions to install dependencies and run the app. Node.js 22 LTS is recommended.

Before submitting a change, run:

```bash
npm run typecheck
npm run lint
npm run build
```

Test the affected workflow manually on your platform as well. If your change is platform-specific, state which operating system and hardware you used.

## Contribution Ideas

The ideas below are useful starting points, not fixed specifications. Please open or claim an issue before beginning one of the larger items.

### Add a macOS screenshot

The README currently has screenshots for Windows and Linux, but not macOS. A contributor with an Apple silicon Mac can help complete the set.

Suggested scope:

- Build and run the application on a supported Apple silicon Mac.
- Capture the main catalog view at a readable resolution, with no personal or sensitive information visible.
- Save the optimized image in `resources/` using a name consistent with the existing screenshots.
- Replace the macOS "Coming soon" entry in the README with the image.
- Include the Mac model, macOS version, and whether the app was run in development or from a packaged build in the pull request.

### Improve the hackathon demo video

The current recording has audio synchronization issues and background footage that does not reinforce the product story.

Suggested scope:

- Create a short, focused walkthrough suitable for a hackathon presentation.
- Show the application itself throughout the demo: hardware detection, model discovery, model loading, chat, RAG, and the local API where practical.
- Use synchronized narration or captions and relevant background footage only.
- Avoid exposing local paths, account details, notifications, or other private information.
- Provide the editable source or a reproducible production note along with the final video.

Because video files can be large, discuss hosting and repository size in an issue before adding media to the repository.

### Display more model information

Model cards could expose additional metadata, such as parameter count, context length, quantization, model size, task, and supported execution providers.

Suggested approach:

- Prefer metadata returned by the Foundry Local SDK rather than maintaining a separate hard-coded catalog.
- Keep model cards easy to scan; move secondary details into an expandable area if needed.
- Define a graceful fallback for metadata that is absent or unknown.
- Verify that search, filtering, and card layout still work at narrow window sizes.

An initial contribution limited to parameter count is welcome if the data source and fallback behavior are clear.

### Improve error handling

Errors should tell users what failed, what state the app is in, and what they can do next without exposing unnecessary implementation details.

Good areas to investigate include:

- SDK initialization and missing native libraries.
- Model download, cancellation, loading, and unloading.
- Chat streaming and local server startup.
- Document parsing and embedding failures.
- Database and filesystem access.

Please preserve useful technical details in main-process logs while presenting concise, actionable messages in the UI. Include reproduction steps and, where practical, a regression test or a deterministic manual test case.

### Add benchmarking

A benchmark capability could help users compare models and execution providers on their own hardware.

Start with a design issue that defines:

- The metrics to collect, such as time to first token, prompt processing speed, generation speed, total latency, and peak memory where reliably available.
- A repeatable prompt, generation settings, warm-up behavior, and run count.
- The model, model variant, execution provider, application version, operating system, and hardware recorded with each result.
- How results are stored, displayed, exported, and cleared.
- Clear labeling that results are local measurements rather than universal model rankings.

The first implementation should favor repeatability and transparent methodology over a large metric set.

### Support bring-your-own models

Allowing users to register compatible local models would extend the app beyond the built-in catalog. This feature needs an agreed design before implementation because model format, tokenizer, runtime compatibility, and execution-provider support all affect whether a model can run.

A proposal should cover:

- Supported model formats and required companion files.
- File or directory selection and validation.
- How custom models are registered, identified, persisted, updated, and removed.
- Compatibility checks and actionable validation errors.
- Security and privacy expectations: model files remain local and are never uploaded by the app.
- How custom models appear alongside catalog models without implying official support.

A useful first slice may be registering one SDK-supported local model format, with validation and removal, before adding broader format support.

## Pull Request Guidelines

Keep pull requests focused and avoid unrelated refactoring. In the description, include:

- What changed and why.
- How the change was tested.
- The operating system and relevant hardware used for manual testing.
- Screenshots or a short recording for visible UI changes.
- Known limitations or follow-up work.

Match the existing Electron security boundary: native SDK, database, and filesystem operations belong in the main process and must be exposed to the renderer through the typed preload API. Do not enable renderer Node.js integration or bypass context isolation.
