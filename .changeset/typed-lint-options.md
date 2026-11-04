---
"dlintr": minor
---

The `env` option is gone; the configuration it carried is typed instead.

`LintOptions` now has `trustedRegistries`, `requireLabels`, `strictLabels` and `disableIgnorePragma`. On Node each one is also read from the matching `HADOLINT_*` variable in `process.env` when the option is absent, so a process can be configured once; an explicit option wins over the variable.

```js
// before
lint(text, { env: { HADOLINT_TRUSTED_REGISTRIES: "docker.io" } })

// after
lint(text, { trustedRegistries: ["docker.io"] })
```

`requireLabels` takes `{ label: type }`, where the type is one of `email`, `hash`, `rfc3339`, `semver`, `spdx`, `text`, `url` — hadolint spells the raw-text one `text`, not `string`.
