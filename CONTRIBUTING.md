# Contributing to Corrente

Thanks for your interest in contributing! This project is licensed under the
[GNU AGPL-3.0-or-later](LICENSE). Contributions are accepted under the same
license, with two short additions described below: a sign-off under the
Developer Certificate of Origin (DCO), and a grant that lets the maintainer
relicense what you contribute.

## Getting started

```bash
yarn             # install dependencies
yarn dev         # start the dev server
yarn test        # run unit tests
yarn test:e2e    # run Playwright end-to-end tests
yarn build       # type-check + production build
yarn lint        # lint
yarn check:server # type-check the Node MCP server
```

Please keep the gates green: `yarn test`, `yarn build`, `yarn lint`, and
`yarn check:server` should all pass before you open a pull request. The coding
conventions live in [CLAUDE.md](CLAUDE.md); skim it before a substantial change.

## Sign-off: the Developer Certificate of Origin

We use the [Developer Certificate of Origin](https://developercertificate.org/)
(DCO) rather than a separately signed contributor agreement. It is a
lightweight statement that you wrote, or otherwise have the right to submit,
the code you are contributing. Signing off also confirms that you agree to the
[licence grant](#licence-grant) below.

To certify it, add a `Signed-off-by` line to every commit, which Git adds for
you with the `-s` flag:

```bash
git commit -s -m "Your commit message"
```

This appends a line using your `user.name` and `user.email`:

```
Signed-off-by: Jane Doe <jane@example.com>
```

Use your real name and a reachable email. Pull requests whose commits are not
signed off cannot be merged. To sign off a series of commits you already made,
`git rebase --signoff <base>` will add the line to each.

> Note: this is distinct from PGP commit *signing* (`-S`). The DCO needs only
> the textual `Signed-off-by` line that `-s` (lowercase) adds.

### Developer Certificate of Origin 1.1

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

## Licence grant

Corrente's open app is AGPL-3.0-or-later, and the same author also runs a hosted
service built on it that is not open source. For that to stay possible, the
maintainer needs to be able to use contributions under terms other than the
AGPL. So, in addition to licensing your contribution under the AGPL:

> You grant Alden Laslett, and any successor who takes over the project, a perpetual,
> worldwide, non-exclusive, royalty-free, irrevocable licence to use, copy,
> modify, distribute, sublicense and relicense your contribution, under any
> terms, including proprietary ones. This includes a licence under any patent
> claims you hold that the contribution necessarily infringes, for the same
> purposes.
>
> You keep the copyright in your contribution, and this does not limit what you
> can do with your own work elsewhere.
>
> The grant covers only what you have the right to grant. If part of your
> contribution is someone else's work (case (b) or (c) of the DCO above), say so
> in the pull request, with its licence.

In practice this changes nothing for anyone using the app, which stays
AGPL-3.0-or-later. It only means the project can keep including your
contribution if its licensing changes, or in the hosted service.

## License headers

New source files should carry a short SPDX header:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Alden Laslett
```

The SPDX identifier is what tooling reads; the full license text lives in
[LICENSE](LICENSE). You do not need to paste the long GPL notice into each file.
