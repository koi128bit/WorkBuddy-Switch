# Security

## Credential handling

WorkBuddy Switch reads the active WorkBuddy authentication document only when an
account is captured, switched, or its quota is refreshed.

- Account snapshots are stored as generic-password items in macOS Keychain.
- The account index contains only display metadata, never access or refresh
  tokens.
- Switching validates the destination snapshot before stopping WorkBuddy.
- The destination document is written through a same-directory temporary file
  with mode `0600` and an atomic replacement.
- If stopping, writing, indexing, or relaunching fails, the prior on-disk
  credential and account index are restored before the prior identity is
  relaunched.
- Tokens are never logged, rendered, cached in quota history, or committed.

## Local data

Conversation metadata and token totals are read from the user's local
`~/.workbuddy` directory. WorkBuddy Switch does not upload message content. The only
network request is a quota request to WorkBuddy's resource endpoint using the
currently active WorkBuddy credential. It runs on launch, on manual refresh,
and at the configured refresh interval.

## Reports

Please use the repository's
[GitHub private vulnerability reporting form](https://github.com/koi128bit/openusage/security/advisories/new).
Reports submitted there are handled as private GitHub Security Advisories, not
public issues.

If GitHub does not show the private reporting form, private vulnerability
reporting may not yet be enabled for the repository. Do not include credentials,
tokens, conversation data, or other sensitive details in a public issue.
Instead, contact the repository owner through their GitHub profile and request
a private reporting channel.
