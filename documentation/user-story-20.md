# User Story 20: Finding explanations

The existing authenticated `POST /api/maintainability` request generates each
finding's explanation along with its score and summary. Expanding a finding is
local UI state: it does not make another AI request or require finding IDs.

## Contract

Requests remain JSON `{ code, filename?, language? }` or multipart field `file`.
Uploads accept the same seven source extensions as `/api/explain`, up to 1 MB.

Each returned smell contains:

| Field | Meaning |
| --- | --- |
| `category`, `severity`, `title` | Existing classification and label |
| `detail` | What is wrong in the supplied code |
| `why` | Why this issue hurts maintainability |
| `bestPractice` | Concrete improvement, example, or rewrite guidance |

The last three fields are non-empty strings. `why` and `bestPractice` support
Markdown. Existing category/severity aliases are normalized; unusable basic
findings are filtered. A retained finding missing either explanation field
fails the entire response. A non-empty result with no usable findings also
fails, so invalid output cannot appear as a clean review. An explicit empty
`smells` array is valid for clean code.

Missing, blank, or non-string code returns 400. Missing, invalid, or expired
JWTs return 401. Provider failures and unusable model results return 500 with
`AI error: Maintainability analysis failed.` No provider payload is returned.
There is no separate explain-issue endpoint or client-supplied finding context;
findings and their context are generated together from the supplied code.

## UI and persistence

Each finding offers a native, keyboard-accessible **Dig deeper** disclosure
with **What is wrong?**, **Why does it matter?**, and **What should I do?** sections.
It uses the existing ReactMarkdown renderer and output-panel styling. Multiple
findings may be expanded independently. Switching files clears the review and
ignores any late response from the previous file.

The main file explanation and Save analysis behavior are unchanged. Saved
analyses still contain only the existing repository/file label and explanation;
maintainability results remain temporary dashboard state. No schema migration
is needed. Deploy the backend and frontend together for the enriched contract.

## Verification

- Backend Jest suite: 58 tests across 5 suites passed with mocked Groq.
- Backend TypeScript check passed; frontend production build and lint passed.
- The build retains the existing large-bundle warning from syntax highlighting.
- Browser smoke checks used the real frontend and Express routes with local
  Groq, Prisma, and GitHub test doubles. They did not exercise a live Groq model
  or production database.

Manual checklist for subsequent verification:

1. Log in, import a repository, select a file, and run Code review.
2. Open two findings independently. Confirm each has a specific problem,
   rationale, and practical recommendation; check Markdown and code examples.
3. Expand/collapse with Enter and Space. Check visible keyboard focus and
   that example code scrolls within the card at narrow viewport widths.
4. Run Analyze with AI, save its explanation, open View saved, and return to
   the dashboard. Confirm the original Markdown and save payload are preserved.
5. Upload a local source file and repeat Code review.
6. Simulate a provider failure. Confirm the safe error is visible and review
   can be retried, without exposing the provider's message.
7. Delay a review response, switch files before it finishes, and confirm the
   previous findings never appear for the new file. Leave the dashboard while
   reviewing and verify navigation remains usable.
