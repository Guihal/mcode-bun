# MCode Bun

MiniMax Code 0.6.12 on Bun 1.4.3, with compiled bytecode, a SQLite
compatibility adapter and request recovery. An independent distribution by
Guihal, based on [MiniMax Code](https://github.com/MiniMax-AI/minimax-code).

The initial build targets are Windows x64 (Windows 10 1809+) and Linux x64
with glibc. Native checks must pass before release publication. Authenticated
interactive/model-session acceptance remains a separate user check.

## Install on Windows

Run in Windows PowerShell 5.1 or later:

    & ([scriptblock]::Create((Invoke-RestMethod https://raw.githubusercontent.com/Guihal/mcode-bun/main/install.ps1)))

The installer downloads the complete archive and SHA-256 checksum, validates
the payload, installs under %LOCALAPPDATA%\MCodeBun and registers mcode and
mcode-tools on User PATH. Reopen already-open terminals. No Node, Bun, npm,
Git, compiler, source build or manual patching is required to install it.
The Windows core shell uses built-in PowerShell; Git Bash and PowerShell 7
remain optional shell choices.

Local zip installation (keep its adjacent .sha256 file):

    powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -ArchivePath .\mcode-0.6.12-bun.1-win32-x64.zip
    mcode --version
    mcode-tools --version

Expected versions are 0.6.12 and 0.0.6. Rerun the same installer to upgrade
or repair. Releases occupy distinct directories; command routing switches
after validation. The upstream updater cannot replace this distribution.

    powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall

Uninstall removes owned routing and recorded distribution files. Configuration,
credentials and sessions are preserved. Keep user files outside payload roots.

## Linux and normal use

Download the Linux tar.gz and adjacent .sha256 from Releases, verify with
sha256sum -c, extract into a dedicated directory and run ./mcode or
./mcode-tools. Optionally add that directory to PATH. Bash and normal Linux
OS utilities are used for shell tools. The build performs no global registration.

Run mcode in your project. Use mcode login for MiniMax, or configure your
own provider through the /model menu or mcode provider --help. Ordinary
upstream account/provider requirements still apply. Data follows upstream's
normal ~/.minimax location unless explicitly configured otherwise.

Keep the entire archive directory together: it contains the compiled app,
private interpreter in runtime/, physical package/ with workers/WASM/assets,
platform clipboard/ripgrep dependencies, tools launchers, notices and manifest.
Optional browser, document, development toolchains and SDK integrations retain
their own requirements. The Unix daemon is unavailable on Windows; stdio
app-server remains available.

Recovery allows five retries after the initial failed provider attempt, stops
on caller cancellation, and publishes text/tools only from a complete
successful attempt. Exhaustion is a failure. Incremental text streaming is
traded for safe partial-failure recovery. No unlimited-reliability or measured
RAM/performance guarantee is made.

## Maintainer build and checks

Use Bun 1.4.3 on the target OS:

    bun install --frozen-lockfile --ignore-scripts
    bun scripts/build.mjs
    bun tests/distribution.mjs

The build fetches the exact npm 0.6.12 tarball and checks the SHA-256 in
[package.json](package.json), applies exact transformations, and installs
dependencies from [bun.lock](bun.lock). No upstream SQLite postinstall runs.
Generated trees/archives live in ignored .build/ and dist/; personal installation
or configuration trees are never imported. [Native CI](.github/workflows/release.yml)
gates release bytes. Controlled fixtures use disposable data and synthetic
loopback credentials, not an authenticated personal session.

Authored distribution code is MIT. The npm package declares MIT. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the archive's licenses/ for
upstream and dependency attribution, including Bun's linked libraries.

самостоятельный чек: bun scripts/build.mjs && bun tests/distribution.mjs + ожидаемый вывод: native archive built and distribution cases pass
