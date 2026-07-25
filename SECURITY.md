# Security

## Credential handling

WorkBuddy Switch handles authentication state for WorkBuddy, Trae CN, and TRAE
Work only when an account is captured, switched, or its usage or allowance is
refreshed.

- Account snapshots and credentials are stored as generic-password items in
  macOS Keychain.
- The account index contains only display metadata, never access or refresh
  tokens.
- WorkBuddy switching validates the destination snapshot before stopping
  WorkBuddy. Its destination document is written through a same-directory
  temporary file with mode `0600` and an atomic replacement.
- If WorkBuddy stopping, writing, indexing, or relaunching fails, the prior
  on-disk credential and account index are restored before the prior identity
  is relaunched.
- Access and refresh tokens are never logged, rendered, cached in quota history,
  or committed.

## Trae data preservation

Trae CN and TRAE Work account switching changes only the authentication state
required for the selected saved account. It does not:

- delete or reset application settings;
- delete plugins or extensions;
- delete workspaces or conversations;
- reset machine identifiers; or
- perform destructive state cleanup.

WorkBuddy Switch does not browse, migrate, or resume Trae conversations.

## Local data

Conversation metadata and token totals are read from the user's local
`~/.workbuddy` directory for WorkBuddy only. WorkBuddy Switch does not upload
WorkBuddy message content.

WorkBuddy quota refreshes access the WorkBuddy resource endpoint. Trae usage and
allowance refreshes access the corresponding Trae APIs. These requests use the
currently selected provider account. The application targets a 15-second
refresh schedule, while Trae fields and freshness depend on the data returned
by Trae.

Before a WorkBuddy cross-account conversation migration, the application
checkpoints SQLite WAL state and creates a consistent backup. Trae conversation
data is never migrated.

## Reports

Please use the repository's
[GitHub private vulnerability reporting form](https://github.com/koi128bit/WorkBuddy-Switch/security/advisories/new).
Reports submitted there are handled as private GitHub Security Advisories, not
public issues.

If GitHub does not show the private reporting form, private vulnerability
reporting may not yet be enabled for the repository. Do not include credentials,
tokens, conversation data, or other sensitive details in a public issue.
Instead, contact the repository owner through their GitHub profile and request
a private reporting channel.
