# Low-Level Design: Pod UI Workbench

## Scope
- `ui/src/routes/+page.svelte`
- `ui/src/lib/Workbench.svelte`
- `ui/src/lib/MarkdownExport.svelte`

## Architecture Context
The Pod UI Workbench provides a front-end dashboard for the Key Collective platform, allowing users to view and manage their Tier Limits, Projects, and Keys (as defined in `src/contracts/v3_types.ts`). It uses Svelte/SvelteKit for the frontend UI.

## Component Details

### 1. `ui/src/routes/+page.svelte`
**Role:** Main route page for the Workbench.
**State:**
- Handles user authentication state or wraps the Workbench view.
- Fetches initial data (Tier Limits, User Account details).
**Interactions:**
- Renders `<Workbench />`.
- Passes user data and project context as props to the Workbench component.

### 2. `ui/src/lib/Workbench.svelte`
**Role:** The core interactive workspace for managing the platform.
**Props/State:**
- `userAccount: UserAccount`
- `projects: Project[]`
- `keys: ProjectKey[]`
**Functionality:**
- Displays the user's tier, Sybil score, and quota usage (RPM/RPD) based on `TierLimits`.
- Lists active projects and project-scoped API keys.
- Allows user interactions like managing keys.
- Integrates the `<MarkdownExport />` component to export configuration/data.
**Dependencies:**
- Types imported from `src/contracts/v3_types.ts`.

### 3. `ui/src/lib/MarkdownExport.svelte`
**Role:** Utility component to export current Workbench state/configurations to a Markdown format.
**Props:**
- `data: any` (The structured data to export, e.g., list of Projects and Keys).
- `filename: string`
**Functionality:**
- Generates a Markdown representation of the provided data using template strings.
- Provides a "Download as Markdown" button that triggers a browser file download using `Blob` and `URL.createObjectURL`.

## Data Contracts
- Relies on `UserTier`, `TierLimits`, `UserAccount`, `Project`, and `ProjectKey` from `v3_types.ts`.
- Adheres to Microdollars and fixed-point formatting for financial data if displayed.
